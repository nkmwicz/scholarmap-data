from langchain_text_splitters import RecursiveCharacterTextSplitter
import polars as pl
from typing import List
from sentence_transformers import SentenceTransformer
import time


def word_len(s: str):
    return len(s.split())

#
#
# Model Name
#
#
model_name = "ibm-granite/granite-embedding-97m-multilingual-r2"


_model = SentenceTransformer(
    model_name, device="cuda"
)


def encode(sentences: List[str]) -> List[List[float]]:
    """
    Generate embeddings for a list of sentences using the IBM Granite embedding model.

    ARGS:
        sentences (List[str]): A list of sentences to generate embeddings for.
    Returns:
        List[List[float]]: A list of embeddings, where each embedding is a list of floats.

    """

    embeddings = _model.encode(
        sentences, 
        batch_size=1, 
        show_progress_bar=True)
    return embeddings.tolist()


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
    print(f"{"*"*25}\nStart Embedding Process, using the {model_name} model...")
    df = df.with_columns(embedding=pl.Series(embeddings))
    t4 = time.time()
    print(f"{"*"*25}\nCompleted embedding process in {t4 - t3:.2f} seconds.")
    
    return df
