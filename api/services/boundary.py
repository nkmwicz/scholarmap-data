import uuid
from dataclasses import dataclass
from typing import Sequence

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import Book, ExcludedPage, OcrPage, Segment, SegmentBoundary


@dataclass
class BoundaryIn:
    boundary_index: int
    page_index: int
    line_index: int
    segment_title: str = ""


async def save_boundaries(
    book_id: uuid.UUID,
    boundaries: list[BoundaryIn],
    excluded_page_indices: list[int],
    db: AsyncSession,
) -> None:
    """
    Idempotently save draft boundary markers and excluded pages.
    Replaces any previously saved draft for this book.
    """
    await db.execute(delete(SegmentBoundary).where(SegmentBoundary.book_id == book_id))
    await db.execute(delete(ExcludedPage).where(ExcludedPage.book_id == book_id))

    for b in boundaries:
        db.add(
            SegmentBoundary(
                book_id=book_id,
                boundary_index=b.boundary_index,
                page_index=b.page_index,
                line_index=b.line_index,
                segment_title=b.segment_title,
            )
        )

    for pi in excluded_page_indices:
        db.add(ExcludedPage(book_id=book_id, page_index=pi))

    await db.commit()


async def confirm_segments(book_id: uuid.UUID, db: AsyncSession) -> int:
    """
    Assemble segments from the saved boundary markers and OCR pages.
    Persists to the segments table and advances book status to segments_complete.
    Returns the number of segments created.
    """
    # Load pages ordered by page_index, excluding excluded pages
    excl_result = await db.execute(
        select(ExcludedPage.page_index).where(ExcludedPage.book_id == book_id)
    )
    excluded = set(excl_result.scalars().all())

    pages_result = await db.execute(
        select(OcrPage).where(OcrPage.book_id == book_id).order_by(OcrPage.page_index)
    )
    pages: list[OcrPage] = list(pages_result.scalars().all())
    page_map = {p.page_index: p for p in pages}

    bounds_result = await db.execute(
        select(SegmentBoundary)
        .where(SegmentBoundary.book_id == book_id)
        .order_by(SegmentBoundary.page_index, SegmentBoundary.line_index)
    )
    boundaries: list[SegmentBoundary] = list(bounds_result.scalars().all())

    if not boundaries:
        return 0

    # Get book document_type
    book_result = await db.execute(select(Book).where(Book.id == book_id))
    book: Book = book_result.scalar_one()

    # Delete any previously confirmed segments
    await db.execute(delete(Segment).where(Segment.book_id == book_id))

    all_page_indices = sorted(
        p.page_index for p in pages if p.page_index not in excluded
    )

    segments = []
    for i, boundary in enumerate(boundaries):
        start_page = boundary.page_index
        start_line = boundary.line_index

        # End is just before the next boundary (or end of document)
        if i + 1 < len(boundaries):
            end_page = boundaries[i + 1].page_index
            end_line = boundaries[i + 1].line_index
        else:
            end_page = all_page_indices[-1] if all_page_indices else start_page
            end_line = None  # include to end of last page

        text_parts: list[str] = []
        page_range: list[int] = []

        for pi in all_page_indices:
            if pi < start_page or pi > end_page:
                continue

            page = page_map.get(pi)
            if page is None:
                continue

            page_lines = page.lines

            if pi == start_page and pi == end_page:
                # Same page: slice between start_line and end_line
                slice_end = end_line if end_line is not None else len(page_lines)
                chunk = "\n".join(page_lines[start_line:slice_end])
            elif pi == start_page:
                chunk = "\n".join(page_lines[start_line:])
            elif pi == end_page and end_line is not None:
                chunk = "\n".join(page_lines[:end_line])
            else:
                chunk = page.markdown

            if chunk.strip():
                text_parts.append(chunk)
                page_range.append(pi)

        markdown = "\n\n".join(text_parts)
        segments.append(
            Segment(
                book_id=book_id,
                segment_index=i,
                title=boundary.segment_title,
                markdown=markdown,
                page_range=page_range,
                document_type=book.document_type,
            )
        )

    db.add_all(segments)
    book.status = "segments_complete"
    await db.commit()

    return len(segments)
