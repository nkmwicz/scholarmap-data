# Scholarmap Data Pipeline

Software pipeline to OCR, chunk, embed, cluster primary sources

## Setting Up the Environment

### GPU Friendly Environment

```{bash}
micromamba create -n scholarmap-data -c pytorch -c nvidia -c anaconda -c conda-forge python=3.12 pytorch pytorch-cuda=12.4 pandas requests polars numpy openai tiktoken langchain-text-splitters jupyter mistralai google-genai ollama-python python-dotenv ipykernel sentence-transformers questionary && micromamba activate scholarmap-data
```

### CPU Only Environment

```{bash}
micromamba create -n scholarmap-data -c anaconda python=3.12 pytorch-cpu pandas requests polars numpy openai tiktoken langchain-text-splitters jupyter mistralai google-genai ollama-python python-dotenv ipykernel sentence-transformers questionary && micromamba activate scholarmap-data
```

## Running the Pipeline

1. Run `s1.process_ocr.py` to OCR a PDF file. This will create a folder in `books_works/{name}/data/` with the name you specify, containing the OCR output as a parquet file.
    - Example: `python s1.process_ocr.py -p path/to/file.pdf -n file_name`
2. Travel to the `books_works/{name}/` folder to access the processed OCR output to manually review or modify it.
    - When working with letters, you will need to transform the OCR output into the actual letters. Mistral AI outputs the OCR in markdown format, so it will help delineate the different letters.
3. Run `s2.embed_ocr.ipynb` to embed the OCR output using Sentence Transformers. This will create a new parquet file in the same folder with the embedded OCR output.

---

## Running the Web App

The web app replaces the manual notebook steps with a browser-based pipeline. It requires Docker.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose v2)
- A `.env` file in the repo root — copy `example.env` and fill in your keys:

```bash
cp example.env .env
```

Minimum required key:

```
MISTRAL_KEY=your_key_here
```

### Start

```bash
docker compose up --build
```

This builds a **CPU-only** API image by default. To use a GPU for faster embedding:

```bash
USE_GPU=true docker compose up --build
```

> **GPU requirements**: NVIDIA GPU + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed on the host. The `USE_GPU=true` flag installs CUDA-enabled PyTorch wheels and enables GPU passthrough in the container.

This starts three services:

| Service | URL | Description |
|---------|-----|-------------|
| `web` | http://localhost:5173 | React/Vite frontend |
| `api` | http://localhost:8000 | FastAPI backend |
| `db` | localhost:5432 | Postgres + pgvector |

The database schema is applied automatically on first start. The first build will take several minutes while `sentence-transformers` and PyTorch are installed into the API image. Subsequent starts are fast.

### Workflow

1. **Create a book** — give it a slug, title, and document type (letters / chapters / other).
2. **Upload a PDF** — triggers Mistral OCR; pages are stored line-by-line in the database.
3. **Open the Boundary Editor** — scroll through OCR pages, click any line to mark it as the start of a new segment, toggle whole pages as excluded (front matter, indices, etc.). The right sidebar shows a live preview of the resulting segments with editable titles. Changes auto-save as a draft every 800 ms.
4. **Confirm** — segments are assembled server-side and written to the database.
5. **Run Embedding** — chunks each segment (chunk size varies by document type) and generates 768-dim embeddings with IBM Granite via `sentence-transformers`.
6. **Run Clustering** — runs k-means++ clustering and sends representative samples to Mistral to generate 5 descriptive tags per cluster.
7. **View Clusters** — browse clusters as cards with tag chips and expandable representative samples.

### Hot Reload (development)

```bash
docker compose watch
```

File changes under `api/` (including `api/clustering/`, `api/genai/`, `api/ocr/`, `api/utils/`, `api/embeds/`) and `web/src/` are synced into the running containers without a full rebuild.

### Stop

```bash
docker compose down        # stop containers, keep data
docker compose down -v     # stop containers and delete the database volume
```
