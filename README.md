# Scholarmap Data Pipeline

Software pipeline to OCR, chunk, embed, cluster primary sources

## Setting Up the Environment

```{bash}
micromamba create -n scholarmap-data -c pytorch -c nvidia -c anaconda -c conda-forge python=3.12 pytorch pytorch-cuda=12.4 pandas requests polars numpy openai tiktoken langchain-text-splitters jupyter mistralai google-genai ollama-python python-dotenv ipykernel sentence-transformers questionary && micromamba activate scholarmap-data
```

## Running the Pipeline

1. Run `s1.process_ocr.py` to OCR a PDF file. This will create a folder in `books_works/{name}/data/` with the name you specify, containing the OCR output as a parquet file.
    a. Example: `python s1.process_ocr.py -p path/to/file.pdf -n file_name`
2. Travel to the `books_works/{name}/` folder to access the processed OCR output to manually review or modify it.
    a. When working with letters, you will need to transform the OCR output into the actual letters. Mistral AI outputs the OCR in markdown format, so it will help delineate the different letters.
3. Run `s2.embed_ocr.ipynb` to embed the OCR output using Sentence Transformers. This will create a new parquet file in the same folder with the embedded OCR output.
