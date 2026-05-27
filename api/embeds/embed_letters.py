import os
import time
from typing import List

import cohere
import polars as pl
from langchain_text_splitters import RecursiveCharacterTextSplitter

_co = cohere.ClientV2(api_key=os.environ["COHERE_API_KEY"])

_EMBED_MODEL = "embed-v4.0"
_EMBED_DIM = 1536
_BATCH_SIZE = 96   # Cohere API limit per call
_INTER_BATCH_DELAY = 0.5   # seconds between batches — ~120 calls/min, well under 2000/min limit
_MAX_RETRIES = 4
_RETRY_BASE_WAIT = 60  # seconds; doubles on each successive 429


def word_len(s: str):
    return len(s.split())


def encode(sentences: List[str], input_type: str = "search_document") -> List[List[float]]:
    """
    Generate embeddings for a list of sentences using Cohere embed-v4.0.

    ARGS:
        sentences (List[str]): A list of sentences to generate embeddings for.
        input_type (str): "search_document" for chunk storage, "search_query" for queries.
    Returns:
        List[List[float]]: A list of 1536-dim float embeddings.
    """
    results: List[List[float]] = []
    for i in range(0, len(sentences), _BATCH_SIZE):
        batch = sentences[i : i + _BATCH_SIZE]

        for attempt in range(_MAX_RETRIES):
            try:
                response = _co.embed(
                    texts=batch,
                    model=_EMBED_MODEL,
                    input_type=input_type,
                    embedding_types=["float"],
                    output_dimension=_EMBED_DIM,
                )
                results.extend(response.embeddings.float_)
                break  # success — move to next batch
            except cohere.TooManyRequestsError:
                if attempt < _MAX_RETRIES - 1:
                    wait = _RETRY_BASE_WAIT * (2 ** attempt)  # 60s, 120s, 240s
                    time.sleep(wait)
                else:
                    raise

        # Preventative delay between batches to stay well under the rate limit.
        # Skipped after the last batch.
        if i + _BATCH_SIZE < len(sentences):
            time.sleep(_INTER_BATCH_DELAY)

    return results


def explode_chunk_text(row):
    """
    Check the token length of the OCR results to ensure they are within the limits for embedding generation. If the token length exceeds the maximum, split the text into smaller chunks using a RecursiveCharacterTextSplitter. This function will return a list of new rows, where each row contains a chunk of the original text and its corresponding metadata. If the token length is within the limits, it will return the original row as a single-item list.

    ARGS:
        row: A row of the DataFrame containing the OCR results and metadata.

    Returns:
        A list of rows, where each row is a dictionary containing the chunked text and its metadata
    """
    md = row["markdown"]
    row["word_length"] = word_len(md)
    id = row["letter_id"]
    row["full_markdown"] = md
    row["chunk_id"] = id + 0.0
    max_words = 2000
    if row["word_length"] > max_words:
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=max_words,
            chunk_overlap=200,
            length_function=word_len,
            separators=["\n\n", "\n", " ", ""],
        )
        chunks = text_splitter.split_text(md)
        new_rows = []
        for i, chunk in enumerate(chunks):
            new_row = row.copy()
            new_row["full_markdown"] = md
            new_row["markdown"] = chunk
            new_row["word_length"] = word_len(chunk)
            new_row["chunk_id"] = id + i / 10
            new_rows.append(new_row)
        return new_rows
    return [row]


def chunk_and_tokenize_letters(df: pl.DataFrame) -> pl.DataFrame:
    """
    Check the token length of the OCR results to ensure they are within the limits for embedding generation. This function can be used to identify any pages that may need to be split or truncated before generating embeddings.

    ARGS:
        df (pl.DataFrame): The DataFrame containing the OCR results and metadata.

    Returns:
        pl.DataFrame: The DataFrame with chunked text and updated metadata.
    """
    t1 = time.time()
    print("Starting chunking and tokenization...")
    df = df.with_row_index("letter_id", offset=10000)
    df = df.with_columns(
        chunk_id=pl.col("letter_id").cast(pl.Float64),
        word_length=pl.lit(0).cast(pl.Int64),
        full_markdown=pl.lit("").cast(pl.Utf8),
    )
    df = (
        df.with_columns(
            pl.struct(pl.all())
            .map_elements(
                explode_chunk_text,
                returns_scalar=True,
                return_dtype=pl.List(pl.Struct(df.schema)),
            )
            .alias("new_rows")
        )
        .select(pl.col("new_rows"))
        .explode("new_rows")
        .unnest("new_rows")
    )
    t2 = time.time()
    print(f"{"*"*25}\nCompleted chunking and tokenization in {t2 - t1:.2f} seconds.")
    texts = df["markdown"].to_list()
    embeddings = encode(texts)
    t3 = time.time()
    print(f"{"*"*25}\nStart Embedding Process, using the {_EMBED_MODEL} model...")
    df = df.with_columns(embedding=pl.Series(embeddings))
    t4 = time.time()
    print(f"{"*"*25}\nCompleted embedding process in {t4 - t3:.2f} seconds.")
    
    return df
