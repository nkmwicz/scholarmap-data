import sys
from pathlib import Path
from utils.check_env import check_environment

check_environment()

from dotenv import load_dotenv
import polars as pl
import questionary

load_dotenv("./.env")

# Expected schema for the processed parquet file
EXPECTED_SCHEMA = {
    "id": pl.UInt32,
    "title": pl.Utf8,
    "pdf_pages": pl.List(pl.Int64),
    "markdown": pl.Utf8,
}

# Find available books_work directories
books_dir = Path("books_work")
if not books_dir.exists():
    print("Error: 'books_work' directory not found. Run s1.process_ocr.py first.")
    sys.exit(1)

available = [d.name for d in sorted(books_dir.iterdir()) if d.is_dir()]
if not available:
    print("Error: No books found in 'books_work'. Run s1.process_ocr.py first.")
    sys.exit(1)

name = questionary.select("Select a book to embed:", choices=available).ask()
if not name:
    sys.exit(0)

data_dir = books_dir / name / "data"
processed_parquet = data_dir / f"{name}.parquet"
ocr_parquet = data_dir / "ocr.parquet"

if not processed_parquet.exists():
    print(f"\nWarning: '{processed_parquet}' not found.")
    if ocr_parquet.exists():
        print(
            f"  'ocr.parquet' exists but has not been processed yet.\n"
            f"  Open 'books_work/{name}/{name}.ipynb' and clean the OCR data to match this schema:\n"
        )
        print(
            f"  {'id':<12} {'title':<8} {'pdf_pages':<16} {'book_pages':<16} {'markdown'}"
        )
        print(f"  {'u32':<12} {'str':<8} {'list[i64]':<16} {'list[str]':<16} {'str'}")
    else:
        print(f"  No parquet files found in '{data_dir}'.")
        print(f"  Run s1.process_ocr.py to generate 'ocr.parquet' first.")
    sys.exit(1)

# Validate schema
df = pl.read_parquet(processed_parquet)
schema_errors = []
for col, dtype in EXPECTED_SCHEMA.items():
    if col not in df.columns:
        schema_errors.append(f"  Missing column: '{col}'")
    elif df[col].dtype != dtype:
        schema_errors.append(f"  Column '{col}': expected {dtype}, got {df[col].dtype}")

if schema_errors:
    print(f"\nWarning: '{processed_parquet}' does not match the expected schema:")
    for err in schema_errors:
        print(err)
    print(f"\n  Expected schema:")
    print(
        f"  {'id':<12} {'title':<8} {'pdf_pages':<16} {'book_pages':<16} {'markdown'}"
    )
    print(f"  {'u32':<12} {'str':<8} {'list[i64]':<16} {'list[str]':<16} {'str'}")
    sys.exit(1)

print(f"\n  Loaded '{processed_parquet}' — {len(df)} rows.")

from embeds.embed_letters import chunk_and_tokenize_letters

choice = questionary.select(
    f"This will overwrite '{processed_parquet}'. What would you like to do?",
    choices=["Overwrite", "Cancel"],
).ask()
if choice != "Overwrite":
    print("Cancelled.")
    sys.exit(0)

try:
    if "id" not in df.columns:
        df = df.with_row_index("id", offset=10000)
    df = chunk_and_tokenize_letters(df)
    df.write_parquet(processed_parquet)
    print(f"\n✓ Done! Embeddings saved to {processed_parquet}")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
