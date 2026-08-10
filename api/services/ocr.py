import logging
import os
import time
import uuid
from pathlib import Path

import httpx
from mistralai.client import Mistral
from mistralai.client.errors import SDKError
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import Book, OcrPage

logger = logging.getLogger(__name__)

# In-memory progress/error messages keyed by book_id string.
# Cleared when a new OCR run starts; left in place on error so the UI can
# show why the last run failed, and cleared again on success.
_ocr_progress: dict[str, str] = {}

_MAX_RETRIES = 3
_RETRY_BASE_WAIT = 5  # seconds; doubles on each successive transient failure
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


def get_ocr_progress(book_id: str) -> str | None:
    return _ocr_progress.get(book_id)


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    if isinstance(exc, SDKError):
        return exc.status_code in _RETRYABLE_STATUS_CODES
    return False


def _describe_error(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return (
            "Mistral didn't respond in time (network timeout) — this can happen "
            f"with very large PDFs. Try again. Details: {exc}"
        )
    if isinstance(exc, httpx.TransportError):
        return (
            "Connection to Mistral was interrupted (network/SSL error), usually "
            f"transient. Try again. Details: {exc}"
        )
    if isinstance(exc, SDKError) and exc.status_code in _RETRYABLE_STATUS_CODES:
        return (
            f"Mistral's API returned an error (status {exc.status_code}), "
            f"usually transient. Try again. Details: {exc}"
        )
    return f"OCR failed: {exc}"


def _with_retries(fn, description: str, book_id: uuid.UUID):
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            return fn()
        except Exception as exc:
            if not _is_retryable(exc):
                raise
            last_exc = exc
            if attempt < _MAX_RETRIES - 1:
                wait = _RETRY_BASE_WAIT * (2**attempt)
                logger.warning(
                    "%s failed for book %s (attempt %d/%d): %s — retrying in %ds",
                    description, book_id, attempt + 1, _MAX_RETRIES, exc, wait,
                )
                _ocr_progress[str(book_id)] = (
                    f"{description} hit a transient error — retrying "
                    f"({attempt + 2}/{_MAX_RETRIES})…"
                )
                time.sleep(wait)
                continue
            raise
    raise last_exc  # pragma: no cover — loop always returns or raises


async def run_ocr(book_id: uuid.UUID, pdf_bytes: bytes, db: AsyncSession) -> None:
    """
    OCR a PDF with Mistral and persist page rows into ocr_pages.
    Updates book status: ocr_processing → ocr_complete.
    """
    api_key = os.environ["MISTRAL_KEY"]
    http_client = httpx.Client(timeout=httpx.Timeout(timeout=300.0, write=300.0))
    client = Mistral(api_key=api_key, timeout_ms=300_000, client=http_client)

    # Update status
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one()
    book.status = "ocr_processing"
    await db.commit()

    pdf_mb = len(pdf_bytes) / 1_048_576
    logger.info("OCR started for book %s (%.1f MB PDF)", book_id, pdf_mb)
    _ocr_progress[str(book_id)] = f"Uploading {pdf_mb:.1f} MB PDF to Mistral…"

    uploaded_file_id: str | None = None
    try:
        # Upload the raw PDF via Mistral's Files API (multipart) instead of
        # inlining it as a base64 data URL — for large files, base64 inflates
        # the payload ~33% and forces one giant single-shot POST, which is far
        # more prone to being interrupted by network/SSL errors or timeouts.
        uploaded = _with_retries(
            lambda: client.files.upload(
                file={"file_name": f"{book_id}.pdf", "content": pdf_bytes},
                purpose="ocr",
            ),
            "PDF upload",
            book_id,
        )
        uploaded_file_id = uploaded.id

        _ocr_progress[str(book_id)] = "Upload complete — requesting signed URL…"
        signed = _with_retries(
            lambda: client.files.get_signed_url(file_id=uploaded.id),
            "Signed URL request",
            book_id,
        )

        _ocr_progress[str(book_id)] = "Running OCR — waiting for response…"
        ocr_response = _with_retries(
            lambda: client.ocr.process(
                model="mistral-ocr-latest",
                document={"type": "document_url", "document_url": signed.url},
                include_image_base64=False,
            ),
            "OCR processing",
            book_id,
        )
    except Exception as exc:
        message = _describe_error(exc)
        logger.error("OCR failed for book %s: %s", book_id, message)
        book.status = "error"
        _ocr_progress[str(book_id)] = message
        await db.commit()
        raise exc
    finally:
        if uploaded_file_id:
            try:
                client.files.delete(file_id=uploaded_file_id)
            except Exception as exc:
                logger.warning(
                    "Failed to delete Mistral file %s for book %s: %s",
                    uploaded_file_id, book_id, exc,
                )

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
