import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.models import Book
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
    if book.status not in ("segments_complete", "embedded"):
        raise HTTPException(
            400, f"Book must be in segments_complete status, currently: {book.status}"
        )

    background_tasks.add_task(embed_book, book_id, db)
    return {"status": "embedding_started"}
