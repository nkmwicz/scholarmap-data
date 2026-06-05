# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Scholarmap is a full-stack app for processing primary source documents (letters, books, chapters) through OCR, segmentation, embedding, and clustering. It exposes a web UI for interactive review and a Python CLI for batch processing.

**Stack**: FastAPI + React/TypeScript/Vite + PostgreSQL (pgvector), dockerized.

**AI/ML integrations**:
- Mistral API — OCR (`mistral-ocr-latest`) and cluster tag generation
- Cohere API — embeddings (`embed-v4.0`, 1536-dim vectors)

## Development Commands

```bash
# Start all services (api:8000, web:5173, db:5432)
docker compose up --build

# Hot reload (watches api/ and web/src/)
docker compose up --watch

# Frontend only (local, no Docker)
cd web && npm run dev
cd web && npm run build
cd web && npm run lint

# Standalone CLI scripts (require micromamba env per README)
python s1.process_ocr.py -p path/to/file.pdf -n file_name
jupyter notebook s2.embed_ocr.ipynb   # embed chunks
jupyter notebook s3.cluster.ipynb     # k-means clustering
```

No backend test suite exists. Testing is manual via the web UI.

## Architecture

### High-Level Data Flow

Documents move through a pipeline of async background jobs, tracked by `Book.status`:

```
pending → ocr_processing → ocr_complete → segments_complete → embedding → embedded → clustering → clustered
```

1. **OCR** (`POST /api/books/{id}/pdf-upload`): Sends PDF to Mistral OCR, stores pages as `OcrPage` rows (markdown + line arrays).
2. **Boundary editing** (web UI): User marks segment boundaries on OCR pages; stored as `SegmentBoundary`/`ExcludedPage`/`ExcludedLine` rows.
3. **Confirm segments** (`POST /api/books/{id}/segments/confirm`): `confirm_segments()` assembles boundaries into `Segment` rows (title, full markdown, page_range).
4. **Embed** (`POST /api/books/{id}/embed`): `embed_book()` chunks each segment (~500 words, 50-word overlap) and calls Cohere in batches of 96 → `SegmentChunk` rows with 1536-dim vectors.
5. **Cluster** (`POST /api/books/{id}/clusters`): k-means++ on embedding matrix → `Cluster` + `ClusterMembership` rows, then Mistral generates 5 tags per cluster.
6. **Search** (`POST /api/search`): Cohere-embed the query, pgvector cosine similarity against all chunks.

### Backend (`api/`)

- `main.py` — FastAPI app, router mounting, CORS
- `models.py` — SQLAlchemy ORM (all tables)
- `db.py` — async engine + session factory
- `routers/` — HTTP handlers (thin layer, delegate to services)
- `services/` — business logic:
  - `ocr.py` → `run_ocr()`
  - `embed.py` → `embed_book()` (chunking + Cohere)
  - `cluster.py` → `_do_clustering()` (k-means + tag generation)
  - `boundary.py` → `save_boundaries()`, `confirm_segments()`
- `embeds/embed_letters.py` — Cohere client: batching (96/call), 0.5s inter-batch delay, 4 retries with exponential backoff on 429
- `clustering/clustering.py` — k-means++ init, hard/soft assignment, representative sampling, subclustering when cluster ≥100 members (k = count^(1/3))

### Frontend (`web/src/`)

- `App.tsx` — Routes: `/` (BookList), `/books/:id` (BookDetail), `/books/:id/boundaries` (SegmentBoundaryEditor), `/books/:id/clusters` (ClusterView)
- `api/client.ts` — All typed API calls go through here
- `pages/SegmentBoundaryEditor.tsx` — Virtualized (TanStack Virtual) page list; local state POSTed periodically
- `pages/ClusterView.tsx` — Hierarchical cluster browser with inline tag editing

### Database

Migrations in `db/migrations/` (sequential SQL, applied at container startup). Key tables: `books`, `ocr_pages`, `segment_boundaries`, `excluded_pages`, `excluded_lines`, `segments`, `segment_chunks` (with `embedding vector(1536)`), `clusters`, `cluster_memberships`.

## Configuration

Copy `example.env` to `.env`. Required keys:

```
MISTRAL_KEY=...
COHERE_API_KEY=...
POSTGRES_PASSWORD=scholarmap
DATABASE_URL=postgresql+asyncpg://scholarmap:{pwd}@db:5432/scholarmap
```

## Common Change Patterns

- **New API endpoint**: Add router in `api/routers/`, register in `api/main.py`, add typed method to `web/src/api/client.ts`.
- **Schema change**: Add SQLAlchemy field to `api/models.py` + new SQL file in `db/migrations/` (next sequential number).
- **Adjust chunk size**: `CHUNK_SIZES` dict in `api/services/embed.py`.
- **Adjust clustering k**: `MIN_SUBCLUSTER_SIZE` or subclustering formula in `api/services/cluster.py`.
- **Change embedding model**: `_EMBED_MODEL` in `api/embeds/embed_letters.py` + migrate `segment_chunks.embedding` dimension.
