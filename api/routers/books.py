import uuid
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.models import Book
from api.services.ocr import run_ocr

router = APIRouter()


class BookCreate(BaseModel):
    slug: str
    title: str
    document_type: str = "letters"


class BookOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    document_type: str
    status: str

    model_config = {"from_attributes": True}


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
        slug=payload.slug, title=payload.title, document_type=payload.document_type
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


@router.get("/{book_id}/pages")
async def get_pages(book_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    from api.models import OcrPage  # avoid circular at module level
    from sqlalchemy import select as sa_select

    result = await db.execute(
        sa_select(OcrPage)
        .where(OcrPage.book_id == book_id)
        .order_by(OcrPage.page_index)
    )
    pages = result.scalars().all()
    return [
        {"page_index": p.page_index, "markdown": p.markdown, "lines": p.lines}
        for p in pages
    ]
