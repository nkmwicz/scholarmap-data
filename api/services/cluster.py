import uuid
import numpy as np
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import Book, Cluster, ClusterMembership, Segment, SegmentChunk


async def cluster_book(book_id: uuid.UUID, db: AsyncSession) -> int:
    """
    Run k-means++ clustering on all segment_chunks for a book.
    Persists clusters and memberships; generates Mistral tags.
    Returns number of clusters created.

    Return types from create_cluster:
      hard_assignment:      list[int]            — cluster index per embed (embed-indexed)
      soft_membership:      list[list[int]]|None — cluster indices per embed (embed-indexed)
      representative_samples: list[list[int]]    — embed indices per cluster (cluster-indexed)
    """
    from api.clustering.clustering import create_cluster  # noqa: PLC0415
    from api.genai.mistral import (
        get_mistral_cluster_tags,
        Cluster as MistralCluster,
    )  # noqa: PLC0415

    book_result = await db.execute(select(Book).where(Book.id == book_id))
    book: Book = book_result.scalar_one()
    book.status = "clustering"
    await db.commit()

    # Load all chunks with embeddings
    chunks_result = await db.execute(
        select(SegmentChunk)
        .join(Segment, SegmentChunk.segment_id == Segment.id)
        .where(Segment.book_id == book_id)
        .where(SegmentChunk.embedding.is_not(None))
    )
    chunks: list[SegmentChunk] = list(chunks_result.scalars().all())

    if not chunks:
        book.status = "embedded"
        await db.commit()
        return 0

    embed_matrix = np.array([c.embedding for c in chunks], dtype=np.float32)

    # hard_assignment[i] = cluster index for embed i
    # soft_membership[i]  = list of all cluster indices embed i belongs to (or None)
    # representative_samples[ci] = list of embed indices for cluster ci
    hard_assignment: list[int]
    soft_membership: list[list[int]] | None
    representative_samples: list[list[int]]
    hard_assignment, soft_membership, representative_samples, _ = create_cluster(
        embed_matrix
    )

    num_clusters = max(hard_assignment) + 1

    # Build a set of representative embed indices per cluster for fast lookup
    rep_set_per_cluster: list[set[int]] = [
        set(representative_samples[ci]) if ci < len(representative_samples) else set()
        for ci in range(num_clusters)
    ]

    # Delete prior clusters for this book
    await db.execute(delete(Cluster).where(Cluster.book_id == book_id))
    await db.commit()

    # Build cluster ORM objects (no tags yet)
    db_clusters: list[Cluster] = [
        Cluster(book_id=book_id, cluster_index=ci, tags=[], is_subcluster=False)
        for ci in range(num_clusters)
    ]
    db.add_all(db_clusters)
    await db.flush()  # populate .id on each object

    # Build memberships
    # Use hard assignment for the primary cluster membership row.
    # soft_membership[i] tells us if embed i also belongs to other clusters (soft),
    # but we only persist the hard-assignment row to keep the schema simple.
    memberships: list[ClusterMembership] = []
    for embed_idx, cluster_idx in enumerate(hard_assignment):
        chunk = chunks[embed_idx]
        is_rep = embed_idx in rep_set_per_cluster[cluster_idx]
        memberships.append(
            ClusterMembership(
                chunk_id=chunk.id,
                cluster_id=db_clusters[cluster_idx].id,
                similarity_score=0.0,  # recomputed on demand if needed
                is_representative=is_rep,
            )
        )

    db.add_all(memberships)
    await db.commit()

    # Generate Mistral tags using representative sample texts
    mistral_clusters: list[MistralCluster] = []
    for ci, db_cluster in enumerate(db_clusters):
        rep_indices = (
            representative_samples[ci] if ci < len(representative_samples) else []
        )
        sample_texts = [chunks[i].text for i in rep_indices if i < len(chunks)]
        mistral_clusters.append(MistralCluster(label=ci, tags=sample_texts))

    labeled = get_mistral_cluster_tags(mistral_clusters)

    for lc in labeled:
        idx = int(lc.label)
        if idx < len(db_clusters):
            db_clusters[idx].tags = lc.tags

    book.status = "labeled"
    await db.commit()

    return num_clusters
