import base64
import json
import os
from mistralai import Mistral
from mistralai.models import OCRResponse

api_key = os.environ["MISTRAL_KEY"]

client = Mistral(api_key=api_key)


def encode_pdf(pdf_path):
    with open(pdf_path, "rb") as pdf_file:
        return base64.b64encode(pdf_file.read()).decode("utf-8")


def ocr_pdf(pdf_path: str) -> OCRResponse:
    base64_pdf = encode_pdf(pdf_path)

    ocr_response = client.ocr.process(
        model="mistral-ocr-latest",
        document={
            "type": "document_url",
            "document_url": f"data:application/pdf;base64,{base64_pdf}",
        },
        include_image_base64=False,
    )
    return ocr_response
