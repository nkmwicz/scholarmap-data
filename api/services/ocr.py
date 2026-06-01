import base64
import logging
import os
import uuid
from pathlib import Path

import httpx
from mistralai.client import Mistral
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import Book, OcrPage

logger = logging.getLogger(__name__)

# In-memory progress messages keyed by book_id string.
# Cleared when OCR completes or errors.
_ocr_progress: dict[str, str] = {}


def get_ocr_progress(book_id: str) -> str | None:
    return _ocr_progress.get(book_id)


async def run_ocr(book_id: uuid.UUID, pdf_bytes: bytes, db: AsyncSession) -> None:
    """
    OCR a PDF with Mistral and persist page rows into ocr_pages.
    Updates book status: ocr_processing → ocr_complete.
    """
    api_key = os.environ["MISTRAL_KEY"]
    # Use a custom httpx client with a generous write timeout so large
    # base64-encoded PDFs don't time out during upload.
    http_client = httpx.Client(timeout=httpx.Timeout(timeout=300.0, write=300.0))
    client = Mistral(api_key=api_key, timeout_ms=300_000, client=http_client)

    # Update status
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one()
    book.status = "ocr_processing"
    await db.commit()

    pdf_mb = len(pdf_bytes) / 1_048_576
    logger.info("OCR started for book %s (%.1f MB PDF)", book_id, pdf_mb)

    encoded = base64.b64encode(pdf_bytes).decode("utf-8")
    _ocr_progress[str(book_id)] = (
        f"Sending {pdf_mb:.1f} MB to Mistral OCR — waiting for response…"
    )

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
        _ocr_progress.pop(str(book_id), None)
        await db.commit()
        raise exc

    page_count = len(ocr_response.pages)
    logger.info("OCR response received for book %s — %d pages", book_id, page_count)
    _ocr_progress[str(book_id)] = f"Response received — saving {page_count} pages…"

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
    _ocr_progress.pop(str(book_id), None)
    await db.commit()
    logger.info("OCR complete for book %s — %d pages saved", book_id, len(pages))
