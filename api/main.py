from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import books, segments, embed, clusters

app = FastAPI(title="Scholarmap API", version="1.0.0")

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


@app.get("/api/health")
async def health():
    return {"status": "ok"}
