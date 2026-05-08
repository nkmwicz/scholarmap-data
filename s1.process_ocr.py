import argparse
from dotenv import load_dotenv

load_dotenv("./.env")

from ocr.ocr_pdf import ocr_pdf

parser = argparse.ArgumentParser(description="Run OCR on a PDF file.")
parser.add_argument("-p", "--path", required=True, help="Path to the PDF file")
parser.add_argument(
    "-n", "--name", required=True, help="Name used for the output folder and file"
)
args = parser.parse_args()

ocr_pdf(pdf_path=args.path, name=args.name)
