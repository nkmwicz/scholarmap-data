FROM python:3.12-slim

# Pass --build-arg USE_GPU=true to install CUDA-enabled PyTorch.
# Requires NVIDIA Container Toolkit on the host and a GPU passed through
# via the docker-compose.yml deploy.resources section.
ARG USE_GPU=false

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install the appropriate PyTorch variant first so sentence-transformers picks it up.
RUN if [ "$USE_GPU" = "true" ]; then \
      pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu124; \
    else \
      pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu; \
    fi

COPY api/requirements.txt /app/api/requirements.txt
RUN pip install --no-cache-dir -r /app/api/requirements.txt

# Copy pipeline modules that api services import
COPY ocr/ /app/ocr/
COPY embeds/ /app/embeds/
COPY clustering/ /app/clustering/
COPY genai/ /app/genai/
COPY utils/ /app/utils/

# Copy api package last
COPY api/ /app/api/

ENV PYTHONPATH=/app

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
