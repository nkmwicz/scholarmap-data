import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.models import Cluster, ClusterMembership, SegmentChunk

router = APIRouter()


class SearchQuery(BaseModel):
    query: str
    limit: int = Field(default=20, ge=1, le=100)


class ClusterLabel(BaseModel):
    parent_index: int
    sub_index: int | None


class SearchResultItem(BaseModel):
    chunk_id: uuid.UUID
    chunk_text: str
    score: float
    segment_id: uuid.UUID
    segment_index: int
    segment_title: str
    page_range: list[int]
    book_id: uuid.UUID
    book_title: str
    book_author: str | None
    book_year: str | None
    cluster_labels: list[ClusterLabel]


@router.post("", response_model=list[SearchResultItem])
async def search(payload: SearchQuery, db: AsyncSession = Depends(get_db)):
    if not payload.query.strip():
        return []

    # Lazy import — model loading is expensive; only done when needed
    from api.embeds.embed_letters import encode  # noqa: PLC0415

    embedding = encode([payload.query.strip()])[0]
    vec_str = "[" + ",".join(str(v) for v in embedding) + "]"

    rows_result = await db.execute(
        text("""
            SELECT
                sc.id            AS chunk_id,
                sc.text          AS chunk_text,
                1 - (sc.embedding <=> CAST(:vec AS vector)) AS score,
                s.id             AS segment_id,
                s.segment_index,
                s.title          AS segment_title,
                s.page_range,
                b.id             AS book_id,
                b.title          AS book_title,
                b.author         AS book_author,
                b.year           AS book_year
            FROM segment_chunks sc
            JOIN segments s ON s.id = sc.segment_id
            JOIN books b ON b.id = s.book_id
            WHERE sc.embedding IS NOT NULL
            ORDER BY sc.embedding <=> CAST(:vec AS vector)
            LIMIT :limit
        """),
        {"vec": vec_str, "limit": payload.limit},
    )
    raw = rows_result.mappings().all()

    if not raw:
        return []

    segment_ids = list({r["segment_id"] for r in raw})
    book_ids = list({r["book_id"] for r in raw})

    # All clusters for the involved books (to build positional indexes)
    all_cl_result = await db.execute(
        select(Cluster)
        .where(Cluster.book_id.in_(book_ids))
        .order_by(Cluster.cluster_index)
    )
    all_clusters = list(all_cl_result.scalars().all())
    cluster_map: dict[uuid.UUID, Cluster] = {c.id: c for c in all_clusters}

    sub_positions: dict[uuid.UUID, dict[uuid.UUID, int]] = {}
    for c in all_clusters:
        if c.is_subcluster and c.parent_cluster_id:
            ps = sub_positions.setdefault(c.parent_cluster_id, {})
            ps[c.id] = len(ps)

    # (segment_id, cluster_id) membership pairs for returned segments
    pairs_result = await db.execute(
        select(SegmentChunk.segment_id, ClusterMembership.cluster_id)
        .join(ClusterMembership, ClusterMembership.chunk_id == SegmentChunk.id)
        .where(SegmentChunk.segment_id.in_(segment_ids))
        .distinct()
    )
    seg_to_clusters: dict[uuid.UUID, set[uuid.UUID]] = {}
    for seg_id, cid in pairs_result.all():
        seg_to_clusters.setdefault(seg_id, set()).add(cid)

    results: list[SearchResultItem] = []
    for r in raw:
        labels: list[ClusterLabel] = []
        seen_parent_ids: set[uuid.UUID] = set()
        for cid in seg_to_clusters.get(r["segment_id"], set()):
            c = cluster_map.get(cid)
            if c is None:
                continue
            if c.is_subcluster and c.parent_cluster_id:
                parent = cluster_map.get(c.parent_cluster_id)
                if parent:
                    sub_pos = sub_positions.get(c.parent_cluster_id, {}).get(c.id, 0)
                    labels.append(
                        ClusterLabel(
                            parent_index=parent.cluster_index, sub_index=sub_pos
                        )
                    )
                    seen_parent_ids.add(c.parent_cluster_id)
            elif not c.is_subcluster and c.id not in seen_parent_ids:
                labels.append(
                    ClusterLabel(parent_index=c.cluster_index, sub_index=None)
                )

        results.append(
            SearchResultItem(
                chunk_id=r["chunk_id"],
                chunk_text=r["chunk_text"],
                score=float(r["score"]),
                segment_id=r["segment_id"],
                segment_index=r["segment_index"],
                segment_title=r["segment_title"],
                page_range=list(r["page_range"]),
                book_id=r["book_id"],
                book_title=r["book_title"],
                book_author=r["book_author"],
                book_year=r["book_year"],
                cluster_labels=sorted(
                    labels,
                    key=lambda x: (
                        x.parent_index,
                        x.sub_index if x.sub_index is not None else -1,
                    ),
                ),
            )
        )

    return results
