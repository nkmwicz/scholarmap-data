import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.models import Book, Cluster, ClusterMembership, SegmentChunk, Segment
from api.services.cluster import cluster_book

router = APIRouter()


class RepresentativeSample(BaseModel):
    chunk_id: uuid.UUID
    text: str
    segment_title: str


class ClusterOut(BaseModel):
    id: uuid.UUID
    cluster_index: int
    tags: list[str]
    is_subcluster: bool
    parent_cluster_id: uuid.UUID | None
    representative_samples: list[RepresentativeSample]

    model_config = {"from_attributes": True}


class SubclusterInfo(BaseModel):
    parent_index: int
    child_count: int


class ClusterStats(BaseModel):
    parent_count: int
    subclusters: list[SubclusterInfo]  # one entry per parent that was split


class ClusterLabel(BaseModel):
    parent_index: int  # 0-based cluster_index of the parent cluster
    sub_index: int | None  # 0-based position among sibling subs; None if top-level


class ClusterSegmentOut(BaseModel):
    id: uuid.UUID
    segment_index: int
    title: str
    markdown: str
    page_range: list[int]
    cluster_labels: list[ClusterLabel]


@router.post("/{book_id}/cluster", status_code=202)
async def trigger_cluster(
    book_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if book.status not in (
        "embedded",
        "clustered",
        "labeled",
        "clustering",
        "labeling",
    ):
        raise HTTPException(
            400, f"Book must be embedded first, currently: {book.status}"
        )

    background_tasks.add_task(cluster_book, book_id, db)
    return {"status": "clustering_started"}


@router.get("/{book_id}/clusters/stats", response_model=ClusterStats)
async def get_cluster_stats(book_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    clusters_result = await db.execute(
        select(Cluster).where(Cluster.book_id == book_id)
    )
    all_clusters: list[Cluster] = list(clusters_result.scalars().all())

    parents = [c for c in all_clusters if not c.is_subcluster]
    children = [c for c in all_clusters if c.is_subcluster]

    parent_index_map: dict[uuid.UUID, int] = {c.id: c.cluster_index for c in parents}

    child_counts: dict[uuid.UUID, int] = {}
    for child in children:
        if child.parent_cluster_id:
            child_counts[child.parent_cluster_id] = (
                child_counts.get(child.parent_cluster_id, 0) + 1
            )

    subclusters = [
        SubclusterInfo(parent_index=parent_index_map[pid], child_count=count)
        for pid, count in sorted(
            child_counts.items(), key=lambda x: parent_index_map.get(x[0], 0)
        )
    ]

    return ClusterStats(parent_count=len(parents), subclusters=subclusters)


@router.get(
    "/{book_id}/clusters/{cluster_id}/segments", response_model=list[ClusterSegmentOut]
)
async def get_cluster_segments(
    book_id: uuid.UUID,
    cluster_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    # 1. All clusters for this book — build positional index for sub-clusters
    all_cl_result = await db.execute(
        select(Cluster)
        .where(Cluster.book_id == book_id)
        .order_by(Cluster.cluster_index)
    )
    all_clusters = list(all_cl_result.scalars().all())
    cluster_map: dict[uuid.UUID, Cluster] = {c.id: c for c in all_clusters}

    # sub_positions[parent_id][sub_id] = 0-based position among that parent's subs
    sub_positions: dict[uuid.UUID, dict[uuid.UUID, int]] = {}
    for c in all_clusters:
        if c.is_subcluster and c.parent_cluster_id:
            parent_subs = sub_positions.setdefault(c.parent_cluster_id, {})
            parent_subs[c.id] = len(parent_subs)

    # 2. Segments belonging to the requested cluster
    segs_result = await db.execute(
        select(Segment)
        .join(SegmentChunk, SegmentChunk.segment_id == Segment.id)
        .join(ClusterMembership, ClusterMembership.chunk_id == SegmentChunk.id)
        .where(ClusterMembership.cluster_id == cluster_id)
        .where(Segment.book_id == book_id)
        .distinct()
        .order_by(Segment.segment_index)
    )
    segments = list(segs_result.scalars().all())
    if not segments:
        return []

    segment_ids = [s.id for s in segments]

    # 3. All (segment_id, cluster_id) pairs for those segments
    pairs_result = await db.execute(
        select(SegmentChunk.segment_id, ClusterMembership.cluster_id)
        .join(ClusterMembership, ClusterMembership.chunk_id == SegmentChunk.id)
        .where(SegmentChunk.segment_id.in_(segment_ids))
        .distinct()
    )
    seg_to_clusters: dict[uuid.UUID, set[uuid.UUID]] = {}
    for seg_id, cid in pairs_result.all():
        seg_to_clusters.setdefault(seg_id, set()).add(cid)

    # 4. Build ClusterLabel lists and assemble output
    out: list[ClusterSegmentOut] = []
    for seg in segments:
        sub_labels: list[ClusterLabel] = []
        seen_parent_ids: set[uuid.UUID] = set()
        top_labels: list[tuple[uuid.UUID, int]] = []

        for cid in seg_to_clusters.get(seg.id, set()):
            c = cluster_map.get(cid)
            if c is None:
                continue
            if c.is_subcluster and c.parent_cluster_id:
                parent = cluster_map.get(c.parent_cluster_id)
                if parent:
                    sub_pos = sub_positions.get(c.parent_cluster_id, {}).get(c.id, 0)
                    sub_labels.append(
                        ClusterLabel(
                            parent_index=parent.cluster_index,
                            sub_index=sub_pos,
                        )
                    )
                    seen_parent_ids.add(c.parent_cluster_id)
            else:
                top_labels.append((c.id, c.cluster_index))

        labels = sub_labels + [
            ClusterLabel(parent_index=ci, sub_index=None)
            for cid, ci in top_labels
            if cid not in seen_parent_ids
        ]
        labels.sort(
            key=lambda l: (
                l.parent_index,
                l.sub_index if l.sub_index is not None else -1,
            )
        )

        out.append(
            ClusterSegmentOut(
                id=seg.id,
                segment_index=seg.segment_index,
                title=seg.title or "",
                markdown=seg.markdown or "",
                page_range=seg.page_range or [],
                cluster_labels=labels,
            )
        )
    return out


@router.get("/{book_id}/clusters", response_model=list[ClusterOut])
async def get_clusters(book_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    clusters_result = await db.execute(
        select(Cluster)
        .where(Cluster.book_id == book_id)
        .order_by(Cluster.cluster_index)
    )
    clusters = clusters_result.scalars().all()

    out: list[ClusterOut] = []
    for cluster in clusters:
        # Fetch representative samples
        reps_result = await db.execute(
            select(SegmentChunk, Segment.title)
            .join(ClusterMembership, ClusterMembership.chunk_id == SegmentChunk.id)
            .join(Segment, SegmentChunk.segment_id == Segment.id)
            .where(ClusterMembership.cluster_id == cluster.id)
            .where(ClusterMembership.is_representative == True)
        )
        samples = [
            RepresentativeSample(
                chunk_id=chunk.id, text=chunk.text, segment_title=title
            )
            for chunk, title in reps_result.all()
        ]
        out.append(
            ClusterOut(
                id=cluster.id,
                cluster_index=cluster.cluster_index,
                tags=cluster.tags,
                is_subcluster=cluster.is_subcluster,
                parent_cluster_id=cluster.parent_cluster_id,
                representative_samples=samples,
            )
        )
    return out
