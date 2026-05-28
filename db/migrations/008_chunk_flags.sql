-- Add neo4j_entered and unimportant flags to segment_chunks,
-- and unimportant flag to segments.

ALTER TABLE segment_chunks ADD COLUMN neo4j_entered BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE segment_chunks ADD COLUMN unimportant   BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE segments ADD COLUMN unimportant BOOLEAN NOT NULL DEFAULT FALSE;
