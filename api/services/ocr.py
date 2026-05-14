import base64
import os
import uuid
from pathlib import Path

from mistralai import Mistral
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import Book, OcrPage


async def run_ocr(book_id: uuid.UUID, pdf_bytes: bytes, db: AsyncSession) -> None:
    """
    OCR a PDF with Mistral and persist page rows into ocr_pages.
    Updates book status: ocr_processing → ocr_complete.
    """
    api_key = os.environ["MISTRAL_KEY"]
    client = Mistral(api_key=api_key)

    # Update status
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one()
    book.status = "ocr_processing"
    await db.commit()

    encoded = base64.b64encode(pdf_bytes).decode("utf-8")

    ocr_response = client.ocr.process(
        model="mistral-ocr-latest",
        document={
            "type": "document_url",
            "document_url": f"data:application/pdf;base64,{encoded}",
        },
        include_image_base64=False,
    )

    # Clear any prior pages for this book
    await db.execute(delete(OcrPage).where(OcrPage.book_id == book_id))

    pages = []
    for p in ocr_response.pages:
        lines = p.markdown.split("\n")
        pages.append(
            OcrPage(
                book_id=book_id,
                page_index=p.index,
                markdown=p.markdown,
                lines=lines,
            )
        )

    db.add_all(pages)
    book.status = "ocr_complete"
    await db.commit()
