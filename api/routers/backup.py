import gzip
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.models import (
    Book,
    Cluster,
    ClusterMembership,
    ExcludedLine,
    ExcludedPage,
    OcrPage,
    Segment,
    SegmentBoundary,
    SegmentChunk,
)

router = APIRouter()


class _Encoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, uuid.UUID):
            return str(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        try:
            import numpy as np  # noqa: PLC0415

            if isinstance(obj, np.ndarray):
                return obj.tolist()
        except ImportError:
            pass
        return super().default(obj)


def _embedding_to_list(emb) -> list[float] | None:
    if emb is None:
        return None
    try:
        import numpy as np  # noqa: PLC0415

        if isinstance(emb, np.ndarray):
            return emb.tolist()
    except ImportError:
        pass
    if isinstance(emb, list):
        return emb
    return list(emb)


@router.get("/export")
async def export_backup(db: AsyncSession = Depends(get_db)):
    books_result = await db.execute(select(Book).order_by(Book.created_at))
    books = books_result.scalars().all()

    payload: dict = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "books": [],
    }

    for book in books:
        book_data: dict = {
            "id": str(book.id),
            "slug": book.slug,
            "title": book.title,
            "author": book.author,
            "year": book.year,
            "volume_number": book.volume_number,
            "description": book.description,
            "document_type": book.document_type,
            "status": book.status,
            "gallica_url": book.gallica_url,
            "gallica_offset": book.gallica_offset,
            "created_at": book.created_at.isoformat() if book.created_at else None,
            "updated_at": book.updated_at.isoformat() if book.updated_at else None,
        }

        pages_res = await db.execute(
            select(OcrPage)
            .where(OcrPage.book_id == book.id)
            .order_by(OcrPage.page_index)
        )
        book_data["ocr_pages"] = [
            {"page_index": p.page_index, "markdown": p.markdown, "lines": p.lines}
            for p in pages_res.scalars().all()
        ]

        ep_res = await db.execute(
            select(ExcludedPage).where(ExcludedPage.book_id == book.id)
        )
        book_data["excluded_pages"] = [
            {"page_index": ep.page_index} for ep in ep_res.scalars().all()
        ]

        el_res = await db.execute(
            select(ExcludedLine).where(ExcludedLine.book_id == book.id)
        )
        book_data["excluded_lines"] = [
            {"page_index": el.page_index, "line_index": el.line_index}
            for el in el_res.scalars().all()
        ]

        sb_res = await db.execute(
            select(SegmentBoundary)
            .where(SegmentBoundary.book_id == book.id)
            .order_by(SegmentBoundary.boundary_index)
        )
        book_data["segment_boundaries"] = [
            {
                "boundary_index": sb.boundary_index,
                "page_index": sb.page_index,
                "line_index": sb.line_index,
                "segment_title": sb.segment_title,
            }
            for sb in sb_res.scalars().all()
        ]

        seg_res = await db.execute(
            select(Segment)
            .where(Segment.book_id == book.id)
            .order_by(Segment.segment_index)
        )
        segments_data = []
        for seg in seg_res.scalars().all():
            chunk_res = await db.execute(
                select(SegmentChunk)
                .where(SegmentChunk.segment_id == seg.id)
                .order_by(SegmentChunk.chunk_index)
            )
            chunks_data = [
                {
                    "id": str(c.id),
                    "chunk_index": c.chunk_index,
                    "text": c.text,
                    "word_length": c.word_length,
                    "embedding": _embedding_to_list(c.embedding),
                    "page_range": c.page_range,
                    "ai_summary": c.ai_summary,
                    "neo4j_entered": c.neo4j_entered,
                    "unimportant": c.unimportant,
                }
                for c in chunk_res.scalars().all()
            ]
            segments_data.append(
                {
                    "id": str(seg.id),
                    "segment_index": seg.segment_index,
                    "title": seg.title,
                    "markdown": seg.markdown,
                    "page_range": seg.page_range,
                    "document_type": seg.document_type,
                    "ai_summary": seg.ai_summary,
                    "neo4j_entered": seg.neo4j_entered,
                    "unimportant": seg.unimportant,
                    "page_char_offsets": seg.page_char_offsets,
                    "chunks": chunks_data,
                }
            )
        book_data["segments"] = segments_data

        cluster_res = await db.execute(
            select(Cluster).where(Cluster.book_id == book.id)
        )
        all_clusters = cluster_res.scalars().all()
        # parents first so FK is satisfied on import
        all_clusters = sorted(
            all_clusters,
            key=lambda c: (c.parent_cluster_id is not None, c.cluster_index),
        )
        clusters_data = []
        for cl in all_clusters:
            cm_res = await db.execute(
                select(ClusterMembership).where(ClusterMembership.cluster_id == cl.id)
            )
            clusters_data.append(
                {
                    "id": str(cl.id),
                    "cluster_index": cl.cluster_index,
                    "tags": cl.tags,
                    "is_subcluster": cl.is_subcluster,
                    "parent_cluster_id": (
                        str(cl.parent_cluster_id) if cl.parent_cluster_id else None
                    ),
                    "memberships": [
                        {
                            "chunk_id": str(m.chunk_id),
                            "similarity_score": m.similarity_score,
                            "is_representative": m.is_representative,
                        }
                        for m in cm_res.scalars().all()
                    ],
                }
            )
        book_data["clusters"] = clusters_data

        payload["books"].append(book_data)

    json_bytes = json.dumps(payload, cls=_Encoder, ensure_ascii=False).encode("utf-8")
    compressed = gzip.compress(json_bytes, compresslevel=9)

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"scholardata-backup-{date_str}.json.gz"
    return Response(
        content=compressed,
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_backup(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    raw = await file.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid JSON: {exc}") from exc

    if payload.get("version") != 1:
        raise HTTPException(400, "Unsupported backup version")

    imported = 0
    for book_data in payload.get("books", []):
        await db.execute(
            text(
                """
                INSERT INTO books
                  (id, slug, title, author, year, volume_number, description,
                   document_type, status, gallica_url, gallica_offset, created_at, updated_at)
                VALUES
                  (:id, :slug, :title, :author, :year, :volume_number, :description,
                   :document_type, :status, :gallica_url, :gallica_offset, :created_at, :updated_at)
                ON CONFLICT (id) DO NOTHING
                """
            ),
            {
                "id": book_data["id"],
                "slug": book_data["slug"],
                "title": book_data["title"],
                "author": book_data.get("author"),
                "year": book_data.get("year"),
                "volume_number": book_data.get("volume_number"),
                "description": book_data.get("description"),
                "document_type": book_data["document_type"],
                "status": book_data["status"],
                "gallica_url": book_data.get("gallica_url"),
                "gallica_offset": book_data.get("gallica_offset"),
                "created_at": book_data.get("created_at"),
                "updated_at": book_data.get("updated_at"),
            },
        )

        for page in book_data.get("ocr_pages", []):
            await db.execute(
                text(
                    """
                    INSERT INTO ocr_pages (book_id, page_index, markdown, lines)
                    VALUES (:book_id, :page_index, :markdown, :lines)
                    ON CONFLICT (book_id, page_index) DO NOTHING
                    """
                ),
                {
                    "book_id": book_data["id"],
                    "page_index": page["page_index"],
                    "markdown": page["markdown"],
                    "lines": page["lines"],
                },
            )

        for ep in book_data.get("excluded_pages", []):
            await db.execute(
                text(
                    """
                    INSERT INTO excluded_pages (book_id, page_index)
                    VALUES (:book_id, :page_index)
                    ON CONFLICT DO NOTHING
                    """
                ),
                {"book_id": book_data["id"], "page_index": ep["page_index"]},
            )

        for el in book_data.get("excluded_lines", []):
            await db.execute(
                text(
                    """
                    INSERT INTO excluded_lines (book_id, page_index, line_index)
                    VALUES (:book_id, :page_index, :line_index)
                    ON CONFLICT DO NOTHING
                    """
                ),
                {
                    "book_id": book_data["id"],
                    "page_index": el["page_index"],
                    "line_index": el["line_index"],
                },
            )

        for sb in book_data.get("segment_boundaries", []):
            await db.execute(
                text(
                    """
                    INSERT INTO segment_boundaries
                      (book_id, boundary_index, page_index, line_index, segment_title)
                    VALUES
                      (:book_id, :boundary_index, :page_index, :line_index, :segment_title)
                    ON CONFLICT (book_id, boundary_index) DO NOTHING
                    """
                ),
                {
                    "book_id": book_data["id"],
                    "boundary_index": sb["boundary_index"],
                    "page_index": sb["page_index"],
                    "line_index": sb["line_index"],
                    "segment_title": sb.get("segment_title", ""),
                },
            )

        for seg in book_data.get("segments", []):
            await db.execute(
                text(
                    """
                    INSERT INTO segments
                      (id, book_id, segment_index, title, markdown, page_range,
                       document_type, ai_summary, neo4j_entered, unimportant, page_char_offsets)
                    VALUES
                      (:id, :book_id, :segment_index, :title, :markdown, :page_range,
                       :document_type, :ai_summary, :neo4j_entered, :unimportant, :page_char_offsets)
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {
                    "id": seg["id"],
                    "book_id": book_data["id"],
                    "segment_index": seg["segment_index"],
                    "title": seg.get("title", ""),
                    "markdown": seg["markdown"],
                    "page_range": seg.get("page_range", []),
                    "document_type": seg["document_type"],
                    "ai_summary": (
                        json.dumps(seg["ai_summary"]) if seg.get("ai_summary") else None
                    ),
                    "neo4j_entered": seg.get("neo4j_entered", False),
                    "unimportant": seg.get("unimportant", False),
                    "page_char_offsets": (
                        json.dumps(seg["page_char_offsets"])
                        if seg.get("page_char_offsets")
                        else None
                    ),
                },
            )

            for chunk in seg.get("chunks", []):
                emb = chunk.get("embedding")
                emb_str = (
                    "[" + ",".join(str(float(v)) for v in emb) + "]"
                    if emb is not None
                    else None
                )
                await db.execute(
                    text(
                        """
                        INSERT INTO segment_chunks
                          (id, segment_id, chunk_index, text, word_length,
                           embedding, page_range, ai_summary, neo4j_entered, unimportant)
                        VALUES
                          (:id, :segment_id, :chunk_index, :text, :word_length,
                           :embedding::vector, :page_range, :ai_summary, :neo4j_entered, :unimportant)
                        ON CONFLICT (id) DO NOTHING
                        """
                    ),
                    {
                        "id": chunk["id"],
                        "segment_id": seg["id"],
                        "chunk_index": chunk["chunk_index"],
                        "text": chunk["text"],
                        "word_length": chunk.get("word_length", 0),
                        "embedding": emb_str,
                        "page_range": chunk.get("page_range", []),
                        "ai_summary": (
                            json.dumps(chunk["ai_summary"])
                            if chunk.get("ai_summary")
                            else None
                        ),
                        "neo4j_entered": chunk.get("neo4j_entered", False),
                        "unimportant": chunk.get("unimportant", False),
                    },
                )

        # Clusters: two passes — parents first, then subclusters
        all_clusters = book_data.get("clusters", [])
        parents = [c for c in all_clusters if c.get("parent_cluster_id") is None]
        children = [c for c in all_clusters if c.get("parent_cluster_id") is not None]

        for cl in parents + children:
            await db.execute(
                text(
                    """
                    INSERT INTO clusters
                      (id, book_id, cluster_index, tags, is_subcluster, parent_cluster_id)
                    VALUES
                      (:id, :book_id, :cluster_index, :tags, :is_subcluster, :parent_cluster_id)
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {
                    "id": cl["id"],
                    "book_id": book_data["id"],
                    "cluster_index": cl["cluster_index"],
                    "tags": cl.get("tags", []),
                    "is_subcluster": cl.get("is_subcluster", False),
                    "parent_cluster_id": cl.get("parent_cluster_id"),
                },
            )

            for m in cl.get("memberships", []):
                await db.execute(
                    text(
                        """
                        INSERT INTO cluster_memberships
                          (chunk_id, cluster_id, similarity_score, is_representative)
                        VALUES
                          (:chunk_id, :cluster_id, :similarity_score, :is_representative)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {
                        "chunk_id": m["chunk_id"],
                        "cluster_id": cl["id"],
                        "similarity_score": m.get("similarity_score", 0.0),
                        "is_representative": m.get("is_representative", False),
                    },
                )

        imported += 1

    await db.commit()
    return {"imported_books": imported}
