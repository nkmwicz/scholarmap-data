import uuid
from dataclasses import dataclass
from typing import Sequence

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import (
    Book,
    ExcludedLine,
    ExcludedPage,
    OcrPage,
    Segment,
    SegmentBoundary,
)


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
    excluded_line_pairs: list[tuple[int, int]] | None = None,
) -> None:
    """
    Idempotently save draft boundary markers, excluded pages, and excluded lines.
    Replaces any previously saved draft for this book.
    """
    await db.execute(delete(SegmentBoundary).where(SegmentBoundary.book_id == book_id))
    await db.execute(delete(ExcludedPage).where(ExcludedPage.book_id == book_id))
    await db.execute(delete(ExcludedLine).where(ExcludedLine.book_id == book_id))

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

    for page_index, line_index in excluded_line_pairs or []:
        db.add(
            ExcludedLine(book_id=book_id, page_index=page_index, line_index=line_index)
        )

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

    excl_lines_result = await db.execute(
        select(ExcludedLine.page_index, ExcludedLine.line_index).where(
            ExcludedLine.book_id == book_id
        )
    )
    excluded_lines: set[tuple[int, int]] = set(excl_lines_result.all())

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

            def _filtered_join(lines: list[str], pi: int, start: int, end: int) -> str:
                return "\n".join(
                    lines[li]
                    for li in range(start, end)
                    if (pi, li) not in excluded_lines
                )

            if pi == start_page and pi == end_page:
                # Same page: slice between start_line and end_line
                slice_end = end_line if end_line is not None else len(page_lines)
                chunk = _filtered_join(page_lines, pi, start_line, slice_end)
            elif pi == start_page:
                chunk = _filtered_join(page_lines, pi, start_line, len(page_lines))
            elif pi == end_page and end_line is not None:
                chunk = _filtered_join(page_lines, pi, 0, end_line)
            else:
                chunk = _filtered_join(page_lines, pi, 0, len(page_lines))

            if chunk.strip():
                text_parts.append(chunk)
                page_range.append(pi)

        markdown = "\n\n".join(text_parts)

        # Build page_char_offsets: maps each page_index → its char start in markdown.
        # text_parts[i] corresponds to page_range[i]; parts are joined with "\n\n".
        page_char_offsets: dict[str, int] = {}
        offset = 0
        for i, part in enumerate(text_parts):
            page_char_offsets[str(page_range[i])] = offset
            offset += len(part)
            if i < len(text_parts) - 1:
                offset += 2  # "\n\n" separator

        segments.append(
            Segment(
                book_id=book_id,
                segment_index=i,
                title=boundary.segment_title,
                markdown=markdown,
                page_range=page_range,
                page_char_offsets=page_char_offsets,
                document_type=book.document_type,
            )
        )

    db.add_all(segments)
    book.status = "segments_complete"
    await db.commit()

    return len(segments)


async def backfill_segment_offsets(book_id: uuid.UUID, db: AsyncSession) -> int:
    """
    Replay the page-assembly logic to compute and store page_char_offsets for all
    existing segments of a book that are missing it.  Does NOT recreate segments.
    Returns the number of segments updated.
    """
    excl_result = await db.execute(
        select(ExcludedPage.page_index).where(ExcludedPage.book_id == book_id)
    )
    excluded = set(excl_result.scalars().all())

    excl_lines_result = await db.execute(
        select(ExcludedLine.page_index, ExcludedLine.line_index).where(
            ExcludedLine.book_id == book_id
        )
    )
    excluded_lines: set[tuple[int, int]] = set(excl_lines_result.all())

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

    segs_result = await db.execute(
        select(Segment)
        .where(Segment.book_id == book_id)
        .order_by(Segment.segment_index)
    )
    existing_segments: list[Segment] = list(segs_result.scalars().all())
    seg_by_index = {s.segment_index: s for s in existing_segments}

    all_page_indices = sorted(
        p.page_index for p in pages if p.page_index not in excluded
    )

    def _filtered_join(lines: list[str], pi: int, start: int, end: int) -> str:
        return "\n".join(
            lines[li] for li in range(start, end) if (pi, li) not in excluded_lines
        )

    updated = 0
    for i, boundary in enumerate(boundaries):
        seg = seg_by_index.get(i)
        if seg is None or seg.page_char_offsets is not None:
            continue  # skip if already has offsets

        start_page = boundary.page_index
        start_line = boundary.line_index

        if i + 1 < len(boundaries):
            end_page = boundaries[i + 1].page_index
            end_line = boundaries[i + 1].line_index
        else:
            end_page = all_page_indices[-1] if all_page_indices else start_page
            end_line = None

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
                slice_end = end_line if end_line is not None else len(page_lines)
                chunk = _filtered_join(page_lines, pi, start_line, slice_end)
            elif pi == start_page:
                chunk = _filtered_join(page_lines, pi, start_line, len(page_lines))
            elif pi == end_page and end_line is not None:
                chunk = _filtered_join(page_lines, pi, 0, end_line)
            else:
                chunk = _filtered_join(page_lines, pi, 0, len(page_lines))

            if chunk.strip():
                text_parts.append(chunk)
                page_range.append(pi)

        page_char_offsets: dict[str, int] = {}
        offset = 0
        for j, part in enumerate(text_parts):
            page_char_offsets[str(page_range[j])] = offset
            offset += len(part)
            if j < len(text_parts) - 1:
                offset += 2  # "\n\n" separator

        seg.page_char_offsets = page_char_offsets
        updated += 1

    await db.commit()
    return updated
