-- AI-generated summary (cached JSON from Mistral) and Neo4j entry tracking
ALTER TABLE segments ADD COLUMN IF NOT EXISTS ai_summary JSONB NULL;
ALTER TABLE segments ADD COLUMN IF NOT EXISTS neo4j_entered BOOLEAN NOT NULL DEFAULT FALSE;
