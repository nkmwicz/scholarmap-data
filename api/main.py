import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import books, segments, embed, clusters, search

logger = logging.getLogger("scholarmap")


@asynccontextmanager
async def lifespan(app: FastAPI):
    import torch

    if torch.cuda.is_available():
        device_name = torch.cuda.get_device_name(0)
        vram = torch.cuda.get_device_properties(0).total_memory // (1024**2)
        logger.info("GPU available: %s (%d MB VRAM)", device_name, vram)
    else:
        logger.info("No GPU detected — running on CPU")
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
app.include_router(search.router, prefix="/api/search", tags=["search"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
