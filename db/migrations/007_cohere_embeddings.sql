-- Migration 007: switch embedding model from granite-97m (384-dim) to Cohere embed-v4.0 (1536-dim)
-- Clears all chunks, clusters, and cluster_memberships for all books.
-- Segments, ai_summary, neo4j_entered, and segment boundaries are fully preserved.

BEGIN;

-- 1. Remove cluster data (cluster_memberships cascade via FK from clusters)
DELETE FROM clusters;

-- 2. Remove all chunk rows (cluster_memberships also cascade from segment_chunks.id FK)
DELETE FROM segment_chunks;

-- 3. Drop the vector index before altering column type
DROP INDEX IF EXISTS segment_chunks_embedding_idx;

-- 4. Change embedding column from vector(384) to vector(1536)
ALTER TABLE segment_chunks ALTER COLUMN embedding TYPE vector(1536);

-- 5. Recreate index using hnsw (better recall than ivfflat for high-dimensional vectors)
CREATE INDEX segment_chunks_embedding_idx ON segment_chunks
    USING hnsw (embedding vector_cosine_ops);

-- 6. Reset book pipeline status so re-embedding can be triggered via the API
UPDATE books
SET status = 'segments_complete'
WHERE status IN ('embedding', 'embedded', 'clustering', 'clustered', 'labeling', 'labeled');

COMMIT;
