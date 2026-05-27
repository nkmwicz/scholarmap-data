import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import books, segments, embed, clusters, search, chunks

logger = logging.getLogger("scholarmap")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Embeddings powered by Cohere embed-v4.0 (1536-dim, API)")
    yield


app = FastAPI(title="Scholarmap API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(books.router, prefix="/api/books", tags=["books"])
app.include_router(segments.router, prefix="/api/books", tags=["segments"])
app.include_router(embed.router, prefix="/api/books", tags=["embed"])
app.include_router(clusters.router, prefix="/api/books", tags=["clusters"])
app.include_router(chunks.router, prefix="/api/books", tags=["chunks"])
app.include_router(search.router, prefix="/api/search", tags=["search"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
