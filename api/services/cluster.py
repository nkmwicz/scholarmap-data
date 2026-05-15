import uuid
from collections import defaultdict

import numpy as np
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import Book, Cluster, ClusterMembership, Segment, SegmentChunk


async def _do_clustering(book_id: uuid.UUID, db: AsyncSession) -> None:
    """
    Phase 1 — pure math, no Mistral.

    Runs k-means++ on all embedded chunks for the book, then for every
    top-level cluster whose member count satisfies count^(1/3) >= 3 it runs a
    second pass with k = int(count^(1/3)) sub-clusters.

    Persists:
      - Cluster rows  (is_subcluster=False / True, parent_cluster_id set for subs)
      - ClusterMembership rows for both levels (is_representative reflects
        the representative samples returned by create_cluster)

    Sets book.status = "clustered" on completion.
    """
    from api.clustering.clustering import create_cluster  # noqa: PLC0415

    book_result = await db.execute(select(Book).where(Book.id == book_id))
    book: Book = book_result.scalar_one()
    book.status = "clustering"
    await db.commit()

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
        return

    embed_matrix = np.array([c.embedding for c in chunks], dtype=np.float32)

    hard_assignment, _soft, representative_samples, _ = create_cluster(embed_matrix)

    num_clusters = max(hard_assignment) + 1
    rep_sets: list[set[int]] = [
        set(representative_samples[ci]) if ci < len(representative_samples) else set()
        for ci in range(num_clusters)
    ]

    # ── Delete prior clusters (cascades to memberships) ──────────────────────
    await db.execute(delete(Cluster).where(Cluster.book_id == book_id))
    await db.commit()

    # ── Top-level clusters ────────────────────────────────────────────────────
    db_clusters: list[Cluster] = [
        Cluster(book_id=book_id, cluster_index=ci, tags=[], is_subcluster=False)
        for ci in range(num_clusters)
    ]
    db.add_all(db_clusters)
    await db.flush()

    # Map cluster index → list of embed indices (needed for sub-clustering)
    cluster_to_indices: dict[int, list[int]] = {ci: [] for ci in range(num_clusters)}
    top_memberships: list[ClusterMembership] = []
    for embed_idx, cluster_idx in enumerate(hard_assignment):
        cluster_to_indices[cluster_idx].append(embed_idx)
        top_memberships.append(
            ClusterMembership(
                chunk_id=chunks[embed_idx].id,
                cluster_id=db_clusters[cluster_idx].id,
                similarity_score=0.0,
                is_representative=embed_idx in rep_sets[cluster_idx],
            )
        )
    db.add_all(top_memberships)
    await db.flush()

    # ── Sub-clusters ──────────────────────────────────────────────────────────
    sub_memberships: list[ClusterMembership] = []
    for ci, db_cluster in enumerate(db_clusters):
        member_indices = cluster_to_indices[ci]
        k = int(len(member_indices) ** (1 / 3))
        if k < 3:
            continue

        sub_embeds = np.array(
            [chunks[i].embedding for i in member_indices], dtype=np.float32
        )
        sub_assignment, _, sub_rep_samples, _ = create_cluster(
            sub_embeds, run_num=1, soft_assign=False, num_clusters=k
        )
        num_sub = max(sub_assignment) + 1
        sub_rep_sets: list[set[int]] = [
            set(sub_rep_samples[sci]) if sci < len(sub_rep_samples) else set()
            for sci in range(num_sub)
        ]

        db_subs: list[Cluster] = [
            Cluster(
                book_id=book_id,
                cluster_index=sci,
                tags=[],
                is_subcluster=True,
                parent_cluster_id=db_cluster.id,
            )
            for sci in range(num_sub)
        ]
        db.add_all(db_subs)
        await db.flush()

        for local_idx, sub_ci in enumerate(sub_assignment):
            sub_memberships.append(
                ClusterMembership(
                    chunk_id=chunks[member_indices[local_idx]].id,
                    cluster_id=db_subs[sub_ci].id,
                    similarity_score=0.0,
                    is_representative=local_idx in sub_rep_sets[sub_ci],
                )
            )

    if sub_memberships:
        db.add_all(sub_memberships)

    book.status = "clustered"
    await db.commit()


async def _do_labeling(book_id: uuid.UUID, db: AsyncSession) -> None:
    """
    Phase 2 — Mistral tagging, no clustering math.

    Queries representative chunks (is_representative=True) for each cluster,
    calls Mistral, and writes tags back.  Sub-clusters are labeled in a
    separate call that receives the parent's tags as context.

    Sets book.status = "labeled" on completion.
    """
    from api.genai.mistral import (  # noqa: PLC0415
        get_mistral_cluster_tags,
        Cluster as MistralCluster,
    )

    book_result = await db.execute(select(Book).where(Book.id == book_id))
    book: Book = book_result.scalar_one()
    book.status = "labeling"
    await db.commit()

    clusters_result = await db.execute(
        select(Cluster).where(Cluster.book_id == book_id)
    )
    all_clusters: list[Cluster] = list(clusters_result.scalars().all())

    top_level = [c for c in all_clusters if not c.is_subcluster]
    sub_clusters = [c for c in all_clusters if c.is_subcluster]

    async def _rep_texts(cluster_id: uuid.UUID) -> list[str]:
        result = await db.execute(
            select(SegmentChunk)
            .join(ClusterMembership, SegmentChunk.id == ClusterMembership.chunk_id)
            .where(ClusterMembership.cluster_id == cluster_id)
            .where(ClusterMembership.is_representative.is_(True))
        )
        return [chunk.text for chunk in result.scalars().all()]

    # ── Label top-level clusters ──────────────────────────────────────────────
    top_input: list[MistralCluster] = []
    for c in top_level:
        top_input.append(MistralCluster(label=str(c.id), tags=await _rep_texts(c.id)))

    for item in get_mistral_cluster_tags(top_input):
        next(c for c in top_level if str(c.id) == item.label).tags = item.tags
    await db.flush()

    # ── Label sub-clusters (grouped by parent so context is passed) ───────────
    parent_tag_str: dict[uuid.UUID, str] = {c.id: ", ".join(c.tags) for c in top_level}
    by_parent: dict[uuid.UUID, list[Cluster]] = defaultdict(list)
    for sc in sub_clusters:
        by_parent[sc.parent_cluster_id].append(sc)

    for parent_id, children in by_parent.items():
        sub_input: list[MistralCluster] = []
        for sc in children:
            sub_input.append(
                MistralCluster(label=str(sc.id), tags=await _rep_texts(sc.id))
            )
        labeled = get_mistral_cluster_tags(
            sub_input,
            is_sub_cluster=True,
            parent_cluster_labels=parent_tag_str.get(parent_id, ""),
        )
        for item in labeled:
            next(sc for sc in children if str(sc.id) == item.label).tags = item.tags

    book.status = "labeled"
    await db.commit()


async def cluster_book(book_id: uuid.UUID, db: AsyncSession) -> int:
    """Entry point called by the router. Runs clustering then labeling."""
    try:
        await _do_clustering(book_id, db)
        await _do_labeling(book_id, db)
    except Exception as exc:
        from sqlalchemy import select as _select  # noqa: PLC0415

        result = await db.execute(_select(Book).where(Book.id == book_id))
        book = result.scalar_one_or_none()
        if book:
            book.status = "error"
            await db.commit()
        raise exc
    result = await db.execute(
        select(Cluster)
        .where(Cluster.book_id == book_id)
        .where(Cluster.is_subcluster.is_(False))
    )
    return len(result.scalars().all())
