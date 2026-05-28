import uuid
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import Book, Segment, SegmentChunk

# Chunk size per document type (words)
CHUNK_SIZES = {
    "letters": 500,
    "chapters": 500,
    "other": 500,
}
CHUNK_OVERLAP = 50


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


def _pages_for_chunk(
    chunk_text: str,
    seg_markdown: str,
    seg_page_range: list[int],
    page_char_offsets: dict,
    search_start: int,
) -> tuple[list[int], int]:
    """
    Find which pages a chunk spans using character offsets stored at segment creation.
    Returns (page_range_for_chunk, next_search_start).
    """
    pos = seg_markdown.find(chunk_text, search_start)
    if pos == -1:
        return seg_page_range, search_start

    chunk_start = pos
    chunk_end = pos + len(chunk_text)

    # Build sorted list of (char_start, page_index)
    sorted_pages = sorted(
        (int(char_start), int(page_idx))
        for page_idx, char_start in page_char_offsets.items()
    )
    total_len = len(seg_markdown)

    covered: list[int] = []
    for i, (pchar_start, page_idx) in enumerate(sorted_pages):
        pchar_end = sorted_pages[i + 1][0] if i + 1 < len(sorted_pages) else total_len
        if pchar_start < chunk_end and pchar_end > chunk_start:
            covered.append(page_idx)

    # Preserve original page order
    page_order = {p: i for i, p in enumerate(seg_page_range)}
    covered.sort(key=lambda p: page_order.get(p, 9999))

    return covered or seg_page_range, pos + 1


async def embed_book(book_id: uuid.UUID, db: AsyncSession) -> int:
    """
    Chunk and embed all segments for a book.
    Stores results in segment_chunks with 1536-dim vectors (Cohere embed-v4.0).
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

    step = max(1, max_words - CHUNK_OVERLAP)

    for seg in segments:
        chunks = _chunk_text(seg.markdown, max_words)
        seg_total_words = _word_len(seg.markdown)
        n_pages = len(seg.page_range) if seg.page_range else 0
        has_offsets = bool(seg.page_char_offsets)
        search_start = 0
        for idx, chunk_text in enumerate(chunks):
            wlen = _word_len(chunk_text)
            if n_pages > 0:
                if has_offsets:
                    chunk_page_range, search_start = _pages_for_chunk(
                        chunk_text,
                        seg.markdown,
                        seg.page_range,
                        seg.page_char_offsets,
                        search_start,
                    )
                elif seg_total_words > 0:
                    # Fallback: ratio estimation (for segments confirmed before migration)
                    word_start = max(0, idx * step - CHUNK_OVERLAP)
                    word_end = min(word_start + wlen, seg_total_words)
                    ps = min(int(word_start / seg_total_words * n_pages), n_pages - 1)
                    pe = min(int(word_end / seg_total_words * n_pages), n_pages - 1)
                    chunk_page_range = seg.page_range[ps : pe + 1] or seg.page_range
                else:
                    chunk_page_range = seg.page_range
            else:
                chunk_page_range = seg.page_range or []
            sc = SegmentChunk(
                segment_id=seg.id,
                chunk_index=idx,
                text=chunk_text,
                word_length=wlen,
                page_range=chunk_page_range,
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
