import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.models import Book, Segment, SegmentChunk
from api.services.embed import embed_book

router = APIRouter()


@router.post("/{book_id}/embed", status_code=202)
async def trigger_embed(
    book_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if book.status not in ("segments_complete", "embedded", "embedding"):
        raise HTTPException(
            400, f"Book must be in segments_complete status, currently: {book.status}"
        )

    background_tasks.add_task(embed_book, book_id, db)
    return {"status": "embedding_started"}


@router.get("/{book_id}/embed/stats")
async def embed_stats(
    book_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    seg_count_result = await db.execute(
        select(func.count()).select_from(Segment).where(Segment.book_id == book_id)
    )
    chunk_count_result = await db.execute(
        select(func.count())
        .select_from(SegmentChunk)
        .join(Segment, Segment.id == SegmentChunk.segment_id)
        .where(Segment.book_id == book_id)
    )
    return {
        "segment_count": seg_count_result.scalar_one(),
        "chunk_count": chunk_count_result.scalar_one(),
    }
