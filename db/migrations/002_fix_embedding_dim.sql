-- Fix embedding column dimension: granite-embedding-97m-multilingual-r2 outputs 384 dims, not 768
DROP INDEX IF EXISTS segment_chunks_embedding_idx;
ALTER TABLE segment_chunks ALTER COLUMN embedding TYPE vector(384);
CREATE INDEX segment_chunks_embedding_idx ON segment_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
