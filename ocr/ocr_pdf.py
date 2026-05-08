import base64
import os
from pathlib import Path
from mistralai import Mistral
import polars as pl
from mistralai.models import OCRResponse

api_key = os.environ["MISTRAL_KEY"]

client = Mistral(api_key=api_key)


def encode_pdf(pdf_path):
    print("  Reading and encoding PDF...")
    with open(pdf_path, "rb") as pdf_file:
        return base64.b64encode(pdf_file.read()).decode("utf-8")


def ocr_pdf(pdf_path: str, name: str) -> None:
    base64_pdf = encode_pdf(pdf_path)

    print("  Sending to Mistral OCR...")
    ocr_response = client.ocr.process(
        model="mistral-ocr-latest",
        document={
            "type": "document_url",
            "document_url": f"data:application/pdf;base64,{base64_pdf}",
        },
        include_image_base64=False,
    )
    print(f"  OCR complete — {len(ocr_response.pages)} pages processed.")

    print("  Building dataset...")
    df = pl.DataFrame(
        {
            "page_index": [p.index for p in ocr_response.pages],
            "markdown": [p.markdown for p in ocr_response.pages],
        }
    )

    out_dir = Path("books_work") / name / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"  Saving to {out_dir} / ocr.parquet...")
    df.write_parquet(out_dir / "ocr.parquet")
