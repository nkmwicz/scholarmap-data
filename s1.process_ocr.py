import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv("./.env")

from ocr.ocr_pdf import ocr_pdf

name = input("Name for the output folder: ").strip()
if not name:
    print("Error: name cannot be empty.")
    sys.exit(1)

path = input("PDF path: ").strip().strip('"')
pdf_path = Path(path)
if not pdf_path.exists():
    print(f"Error: file not found: {pdf_path}")
    sys.exit(1)
if pdf_path.suffix.lower() != ".pdf":
    print(f"Error: expected a .pdf file, got: {pdf_path.suffix}")
    sys.exit(1)

out_path = Path("books_work") / name / "data" / "ocr.parquet"
if out_path.exists():
    print(f"\n'{out_path}' already exists.")
    print("  [1] Overwrite")
    print("  [2] Cancel")
    choice = input("Choose an option: ").strip()
    if choice == "1":
        pass
    else:
        print("Cancelled.")
        sys.exit(0)

try:
    ocr_pdf(pdf_path=str(pdf_path), name=name)
except KeyError:
    print("Error: MISTRAL_KEY not found. Check your .env file.")
    sys.exit(1)
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
