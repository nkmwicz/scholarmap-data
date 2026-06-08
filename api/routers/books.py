import uuid
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
)
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.models import Book, Cluster, ExcludedLine, ExcludedPage, OcrPage, Segment
from api.services.ocr import get_ocr_progress, run_ocr

router = APIRouter()


class BookCreate(BaseModel):
    slug: str
    title: str
    author: str | None = None
    year: str | None = None
    volume_number: int | None = None
    description: str | None = None
    document_type: str = "letters"


class BookOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    author: str | None
    year: str | None
    volume_number: int | None
    description: str | None
    document_type: str
    status: str
    gallica_url: str | None
    gallica_offset: int | None

    model_config = {"from_attributes": True}


class GallicaUpdate(BaseModel):
    gallica_url: str
    gallica_offset: int


@router.get("", response_model=list[BookOut])
async def list_books(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Book).order_by(Book.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=BookOut, status_code=201)
async def create_book(payload: BookCreate, db: AsyncSession = Depends(get_db)):
    if payload.document_type not in ("letters", "chapters", "other"):
        raise HTTPException(400, "document_type must be letters, chapters, or other")
    existing = await db.execute(select(Book).where(Book.slug == payload.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"Slug '{payload.slug}' already exists")
    book = Book(
        slug=payload.slug,
        title=payload.title,
        author=payload.author,
        year=payload.year,
        volume_number=payload.volume_number,
        description=payload.description,
        document_type=payload.document_type,
    )
    db.add(book)
    await db.commit()
    await db.refresh(book)
    return book


@router.get("/{book_id}", response_model=BookOut)
async def get_book(book_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    return book


@router.patch("/{book_id}/gallica", response_model=BookOut)
async def set_gallica(
    book_id: uuid.UUID, payload: GallicaUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    book.gallica_url = payload.gallica_url
    book.gallica_offset = payload.gallica_offset
    await db.commit()
    await db.refresh(book)
    return book


@router.post("/{book_id}/reset-to-boundaries", status_code=200)
async def reset_to_boundaries(book_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    allowed = {"embedded", "embedding", "clustering", "clustered", "labeling", "labeled", "error"}
    if book.status not in allowed:
        raise HTTPException(400, f"Cannot reset from status '{book.status}'")

    await db.execute(delete(Cluster).where(Cluster.book_id == book_id))
    await db.execute(delete(Segment).where(Segment.book_id == book_id))
    book.status = "ocr_complete"
    await db.commit()
    return {"status": "ocr_complete"}


@router.post("/{book_id}/ocr", status_code=202)
async def upload_pdf(
    book_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    pdf: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if pdf.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(400, "File must be a PDF")

    pdf_bytes = await pdf.read()
    background_tasks.add_task(run_ocr, book_id, pdf_bytes, db)
    return {"status": "ocr_started"}


@router.get("/{book_id}/ocr/progress")
async def get_ocr_progress_endpoint(book_id: uuid.UUID):
    """Return the current in-memory OCR progress message for a book (no DB query)."""
    return {"message": get_ocr_progress(str(book_id))}


@router.get("/{book_id}/pages")
async def get_pages(book_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(OcrPage).where(OcrPage.book_id == book_id).order_by(OcrPage.page_index)
    )
    pages = result.scalars().all()
    return [
        {"page_index": p.page_index, "markdown": p.markdown, "lines": p.lines}
        for p in pages
    ]


@router.get("/{book_id}/ocr/markdown")
async def download_ocr_markdown(book_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Return a .md file of all non-excluded OCR pages, one ## Page Index heading per page."""
    book_result = await db.execute(select(Book).where(Book.id == book_id))
    book = book_result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if book.status in ("pending", "ocr_processing"):
        raise HTTPException(400, "OCR has not completed yet")

    excl_result = await db.execute(
        select(ExcludedPage.page_index).where(ExcludedPage.book_id == book_id)
    )
    excluded = set(excl_result.scalars().all())

    excl_lines_result = await db.execute(
        select(ExcludedLine.page_index, ExcludedLine.line_index).where(
            ExcludedLine.book_id == book_id
        )
    )
    excluded_lines_by_page: dict[int, set[int]] = {}
    for row in excl_lines_result.all():
        excluded_lines_by_page.setdefault(row[0], set()).add(row[1])

    pages_result = await db.execute(
        select(OcrPage).where(OcrPage.book_id == book_id).order_by(OcrPage.page_index)
    )
    pages = [p for p in pages_result.scalars().all() if p.page_index not in excluded]

    parts = []
    for p in pages:
        excl_li = excluded_lines_by_page.get(p.page_index, set())
        body = "\n".join(line for li, line in enumerate(p.lines) if li not in excl_li)
        parts.append(f"## Page Index {p.page_index + 1}\n\n{body}")
    content = "\n\n".join(parts)

    filename = f"{book.slug}.md"
    return Response(
        content=content,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
