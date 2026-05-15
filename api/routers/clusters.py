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
