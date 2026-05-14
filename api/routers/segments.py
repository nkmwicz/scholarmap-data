import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.models import Book, Segment, SegmentBoundary, ExcludedPage
from api.services.boundary import BoundaryIn, save_boundaries, confirm_segments

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────


class BoundaryItem(BaseModel):
    boundary_index: int
    page_index: int
    line_index: int
    segment_title: str = ""


class BoundariesPayload(BaseModel):
    boundaries: list[BoundaryItem]
    excluded_pages: list[int] = []


class BoundariesOut(BaseModel):
    boundaries: list[BoundaryItem]
    excluded_pages: list[int]


class SegmentOut(BaseModel):
    id: uuid.UUID
    segment_index: int
    title: str
    markdown: str
    page_range: list[int]
    document_type: str

    model_config = {"from_attributes": True}


# ── Boundaries ────────────────────────────────────────────────────────────────


@router.post("/{book_id}/boundaries", status_code=204)
async def post_boundaries(
    book_id: uuid.UUID,
    payload: BoundariesPayload,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Book not found")

    boundaries_in = [
        BoundaryIn(
            boundary_index=b.boundary_index,
            page_index=b.page_index,
            line_index=b.line_index,
            segment_title=b.segment_title,
        )
        for b in payload.boundaries
    ]
    await save_boundaries(book_id, boundaries_in, payload.excluded_pages, db)


@router.get("/{book_id}/boundaries", response_model=BoundariesOut)
async def get_boundaries(book_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    bounds_result = await db.execute(
        select(SegmentBoundary)
        .where(SegmentBoundary.book_id == book_id)
        .order_by(SegmentBoundary.boundary_index)
    )
    excl_result = await db.execute(
        select(ExcludedPage.page_index).where(ExcludedPage.book_id == book_id)
    )
    boundaries = [
        BoundaryItem(
            boundary_index=b.boundary_index,
            page_index=b.page_index,
            line_index=b.line_index,
            segment_title=b.segment_title,
        )
        for b in bounds_result.scalars().all()
    ]
    excluded = list(excl_result.scalars().all())
    return BoundariesOut(boundaries=boundaries, excluded_pages=excluded)


# ── Segments ──────────────────────────────────────────────────────────────────


@router.post("/{book_id}/segments/confirm", status_code=202)
async def confirm_segments_endpoint(
    book_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    background_tasks.add_task(confirm_segments, book_id, db)
    return {"status": "assembling_segments"}


@router.get("/{book_id}/segments", response_model=list[SegmentOut])
async def list_segments(book_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Segment)
        .where(Segment.book_id == book_id)
        .order_by(Segment.segment_index)
    )
    return result.scalars().all()
