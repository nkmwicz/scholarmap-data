import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.models import Segment, SegmentChunk

router = APIRouter()


class ChunkSummaryOut(BaseModel):
    chunk_id: uuid.UUID
    ai_summary: dict | None = None


class ChunkPatch(BaseModel):
    neo4j_entered: bool | None = None
    unimportant: bool | None = None


class ChunkOut(BaseModel):
    chunk_id: uuid.UUID
    neo4j_entered: bool = False
    unimportant: bool = False

    model_config = {"from_attributes": True}


@router.patch("/{book_id}/chunks/{chunk_id}", response_model=ChunkOut)
async def patch_chunk(
    book_id: uuid.UUID,
    chunk_id: uuid.UUID,
    payload: ChunkPatch,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SegmentChunk)
        .join(Segment, Segment.id == SegmentChunk.segment_id)
        .where(SegmentChunk.id == chunk_id, Segment.book_id == book_id)
    )
    chunk = result.scalar_one_or_none()
    if chunk is None:
        raise HTTPException(status_code=404, detail="Chunk not found")

    if payload.neo4j_entered is not None:
        chunk.neo4j_entered = payload.neo4j_entered
    if payload.unimportant is not None:
        chunk.unimportant = payload.unimportant

    await db.commit()
    await db.refresh(chunk)
    return ChunkOut(
        chunk_id=chunk.id,
        neo4j_entered=chunk.neo4j_entered,
        unimportant=chunk.unimportant,
    )


@router.post("/{book_id}/chunks/{chunk_id}/summary", response_model=ChunkSummaryOut)
async def generate_chunk_summary(
    book_id: uuid.UUID,
    chunk_id: uuid.UUID,
    force: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SegmentChunk)
        .join(Segment, Segment.id == SegmentChunk.segment_id)
        .where(SegmentChunk.id == chunk_id, Segment.book_id == book_id)
    )
    chunk = result.scalar_one_or_none()
    if chunk is None:
        raise HTTPException(status_code=404, detail="Chunk not found")

    if chunk.ai_summary and not force:
        return ChunkSummaryOut(chunk_id=chunk.id, ai_summary=chunk.ai_summary)

    from api.genai.mistral import get_mistral_chapter_summary  # noqa: PLC0415

    summary_obj = await asyncio.to_thread(get_mistral_chapter_summary, chunk.text)
    chunk.ai_summary = summary_obj.model_dump()
    await db.commit()
    await db.refresh(chunk)
    return ChunkSummaryOut(chunk_id=chunk.id, ai_summary=chunk.ai_summary)
