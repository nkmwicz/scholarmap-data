-- Add Gallica image viewer fields to books
ALTER TABLE books ADD COLUMN IF NOT EXISTS gallica_url VARCHAR;
ALTER TABLE books ADD COLUMN IF NOT EXISTS gallica_offset INTEGER;
