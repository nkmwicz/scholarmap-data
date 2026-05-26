-- Migration 006: add page_range and ai_summary to segment_chunks

ALTER TABLE segment_chunks ADD COLUMN page_range INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE segment_chunks ADD COLUMN ai_summary JSONB;
