import sys
from pathlib import Path
from utils.check_env import check_environment

check_environment()

from dotenv import load_dotenv
import questionary

load_dotenv("./.env")

from ocr.ocr_pdf import ocr_pdf

name = questionary.text("Name for this document (must be unique):").ask()
if not name or not name.strip():
    print("Error: name cannot be empty.")
    sys.exit(1)
name = name.strip()

path = questionary.path("PDF path:", only_directories=False).ask()
if not path:
    sys.exit(0)
path = path.strip().strip('"')
pdf_path = Path(path)
if not pdf_path.exists():
    print(f"Error: file not found: {pdf_path}")
    sys.exit(1)
if pdf_path.suffix.lower() != ".pdf":
    print(f"Error: expected a .pdf file, got: {pdf_path.suffix}")
    sys.exit(1)

out_path = Path("books_work") / name / "data" / "ocr.parquet"
if out_path.exists():
    choice = questionary.select(
        f"'{out_path}' already exists. What would you like to do?",
        choices=["Overwrite", "Cancel"],
    ).ask()
    if choice != "Overwrite":
        print("Cancelled.")
        sys.exit(0)

try:
    ocr_pdf(pdf_path=str(pdf_path), name=name)
    print(f"\n✓ Done! OCR results saved to books_work/{name}/data/ocr.parquet")
except KeyError:
    print("Error: MISTRAL_KEY not found. Check your .env file.")
    sys.exit(1)
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
