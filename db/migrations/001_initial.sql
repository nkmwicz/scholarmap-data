CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Books / primary source collections
CREATE TABLE books (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug          TEXT NOT NULL UNIQUE,
    title         TEXT NOT NULL,
    author        TEXT,
    year          TEXT,
    volume_number INT,
    description   TEXT,
    document_type TEXT NOT NULL DEFAULT 'letters' CHECK (document_type IN ('letters', 'chapters', 'other')),
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Raw OCR pages from Mistral
CREATE TABLE ocr_pages (
    id          BIGSERIAL PRIMARY KEY,
    book_id     UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_index  INT NOT NULL,
    markdown    TEXT NOT NULL,
    lines       TEXT[] NOT NULL DEFAULT '{}',
    UNIQUE (book_id, page_index)
);

CREATE INDEX ocr_pages_book_idx ON ocr_pages(book_id);

-- Pages to skip (front/back matter etc.)
CREATE TABLE excluded_pages (
    book_id     UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_index  INT NOT NULL,
    PRIMARY KEY (book_id, page_index)
);

-- User-defined segment boundary markers (line-level)
CREATE TABLE segment_boundaries (
    id              BIGSERIAL PRIMARY KEY,
    book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    boundary_index  INT NOT NULL,
    page_index      INT NOT NULL,
    line_index      INT NOT NULL,
    segment_title   TEXT NOT NULL DEFAULT '',
    UNIQUE (book_id, boundary_index)
);

CREATE INDEX segment_boundaries_book_idx ON segment_boundaries(book_id);

-- Confirmed segments (assembled from boundaries server-side)
CREATE TABLE segments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    segment_index   INT NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    markdown        TEXT NOT NULL,
    page_range      INT[] NOT NULL DEFAULT '{}',
    document_type   TEXT NOT NULL,
    UNIQUE (book_id, segment_index)
);

CREATE INDEX segments_book_idx ON segments(book_id);

-- Chunks of segments with embeddings
CREATE TABLE segment_chunks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    segment_id      UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    chunk_index     INT NOT NULL,
    text            TEXT NOT NULL,
    word_length     INT NOT NULL DEFAULT 0,
    embedding       vector(384),
    UNIQUE (segment_id, chunk_index)
);

CREATE INDEX segment_chunks_segment_idx ON segment_chunks(segment_id);
CREATE INDEX segment_chunks_embedding_idx ON segment_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Clusters
CREATE TABLE clusters (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id             UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    cluster_index       INT NOT NULL,
    tags                TEXT[] NOT NULL DEFAULT '{}',
    is_subcluster       BOOLEAN NOT NULL DEFAULT FALSE,
    parent_cluster_id   UUID REFERENCES clusters(id) ON DELETE SET NULL
);

CREATE INDEX clusters_book_idx ON clusters(book_id);

-- Chunk ↔ cluster membership
CREATE TABLE cluster_memberships (
    chunk_id            UUID NOT NULL REFERENCES segment_chunks(id) ON DELETE CASCADE,
    cluster_id          UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    similarity_score    FLOAT NOT NULL DEFAULT 0,
    is_representative   BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (chunk_id, cluster_id)
);

CREATE INDEX cluster_memberships_cluster_idx ON cluster_memberships(cluster_id);
