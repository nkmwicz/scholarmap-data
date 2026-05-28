-- Store per-page character offsets in the assembled segment markdown.
-- Used by the chunker to map chunk text positions to exact page indices.

ALTER TABLE segments ADD COLUMN page_char_offsets JSONB;
