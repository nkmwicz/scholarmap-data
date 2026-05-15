import uuid
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import Book, Segment, SegmentChunk

# Chunk size per document type (words)
CHUNK_SIZES = {
    "letters": 500,
    "chapters": 2000,
    "other": 2000,
}
CHUNK_OVERLAP = 200


def _word_len(s: str) -> int:
    return len(s.split())


def _chunk_text(text: str, max_words: int) -> list[str]:
    if _word_len(text) <= max_words:
        return [text]
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=max_words,
        chunk_overlap=CHUNK_OVERLAP,
        length_function=_word_len,
        separators=["\n\n", "\n", " ", ""],
    )
    return splitter.split_text(text)


async def embed_book(book_id: uuid.UUID, db: AsyncSession) -> int:
    """
    Chunk and embed all segments for a book.
    Stores results in segment_chunks with 384-dim vectors.
    Returns total chunk count.
    """
    # Lazy import — model loading is expensive; only done when needed
    from api.embeds.embed_letters import encode  # noqa: PLC0415

    book_result = await db.execute(select(Book).where(Book.id == book_id))
    book: Book = book_result.scalar_one()
    book.status = "embedding"
    await db.commit()

    segments_result = await db.execute(
        select(Segment)
        .where(Segment.book_id == book_id)
        .order_by(Segment.segment_index)
    )
    segments: list[Segment] = list(segments_result.scalars().all())

    max_words = CHUNK_SIZES.get(book.document_type, 2000)

    # Delete prior chunks
    for seg in segments:
        await db.execute(delete(SegmentChunk).where(SegmentChunk.segment_id == seg.id))
    await db.commit()

    all_chunks: list[SegmentChunk] = []
    all_texts: list[str] = []

    for seg in segments:
        chunks = _chunk_text(seg.markdown, max_words)
        for idx, chunk_text in enumerate(chunks):
            sc = SegmentChunk(
                segment_id=seg.id,
                chunk_index=idx,
                text=chunk_text,
                word_length=_word_len(chunk_text),
            )
            all_chunks.append(sc)
            all_texts.append(chunk_text)

    try:
        if all_texts:
            embeddings = encode(all_texts)
            for sc, emb in zip(all_chunks, embeddings):
                sc.embedding = emb
    except Exception as exc:
        book.status = "error"
        await db.commit()
        raise exc

    db.add_all(all_chunks)
    book.status = "embedded"
    await db.commit()

    return len(all_chunks)
