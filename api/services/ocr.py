import base64
import logging
import os
import uuid
from pathlib import Path

from mistralai.client import Mistral
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import Book, OcrPage

logger = logging.getLogger(__name__)


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

    pdf_mb = len(pdf_bytes) / 1_048_576
    logger.info("OCR started for book %s (%.1f MB PDF)", book_id, pdf_mb)

    encoded = base64.b64encode(pdf_bytes).decode("utf-8")

    try:
        ocr_response = client.ocr.process(
            model="mistral-ocr-latest",
            document={
                "type": "document_url",
                "document_url": f"data:application/pdf;base64,{encoded}",
            },
            include_image_base64=False,
        )
    except Exception as exc:
        logger.error("OCR failed for book %s: %s", book_id, exc)
        book.status = "error"
        await db.commit()
        raise exc

    logger.info(
        "OCR response received for book %s — %d pages", book_id, len(ocr_response.pages)
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
    logger.info("OCR complete for book %s — %d pages saved", book_id, len(pages))
