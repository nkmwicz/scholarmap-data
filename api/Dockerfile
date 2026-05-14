FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

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
