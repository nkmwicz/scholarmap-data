import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Book, type ClusterStats } from "../api/client";
import StatusBadge from "../components/StatusBadge";

export default function BookDetail() {
  const { bookId } = useParams<{ bookId: string }>();
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [boundaryCount, setBoundaryCount] = useState<number | null>(null);
  const [embedStats, setEmbedStats] = useState<{
    segment_count: number;
    chunk_count: number;
  } | null>(null);
  const [clusterStats, setClusterStats] = useState<ClusterStats | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const load = () => {
    api.books
      .get(bookId!)
      .then(setBook)
      .catch((e) => setError(e.message));
  };

  const PROCESSING_STATUSES = [
    "ocr_processing",
    "embedding",
    "clustering",
    "labeling",
  ];

  useEffect(() => {
    load();
    if (bookId)
      api.boundaries
        .get(bookId)
        .then((data) => setBoundaryCount(data.boundaries.length))
        .catch(() => {});
  }, [bookId]);

  // Reload embed stats whenever the status reaches or passes the embed step
  const EMBED_STATUSES = [
    "segments_complete",
    "embedding",
    "embedded",
    "clustering",
    "clustered",
    "labeling",
    "labeled",
  ];
  useEffect(() => {
    if (!bookId || !book?.status) return;
    if (!EMBED_STATUSES.includes(book.status)) return;
    api.embed
      .stats(bookId)
      .then(setEmbedStats)
      .catch(() => {});
  }, [bookId, book?.status]);

  const CLUSTER_STATUSES = ["clustered", "labeling", "labeled"];
  useEffect(() => {
    if (!bookId || !book?.status) return;
    if (!CLUSTER_STATUSES.includes(book.status)) return;
    api.clusters
      .stats(bookId)
      .then(setClusterStats)
      .catch(() => {});
  }, [bookId, book?.status]);

  // Poll only while actively processing
  useEffect(() => {
    if (!book || !PROCESSING_STATUSES.includes(book.status)) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [bookId, book?.status]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !bookId) return;
    setUploading(true);
    try {
      await api.books.uploadPdf(bookId, file);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleEmbed = async () => {
    try {
      await api.embed.trigger(bookId!);
      setBook((prev) => (prev ? { ...prev, status: "embedding" } : prev));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleCluster = async () => {
    try {
      await api.clusters.trigger(bookId!);
      setBook((prev) => (prev ? { ...prev, status: "clustering" } : prev));
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!book) return <p>Loading…</p>;

  const canUpload = book.status !== "ocr_processing";
  const ocrDone = !["pending", "ocr_processing", "error"].includes(book.status);
  const canMark = [
    "ocr_complete",
    "boundaries_pending",
    "segments_complete",
  ].includes(book.status);
  const canEmbed = ["segments_complete", "embedded", "embedding"].includes(
    book.status,
  );
  const canCluster = [
    "embedded",
    "clustered",
    "labeled",
    "clustering",
    "labeling",
  ].includes(book.status);

  return (
    <div style={{ maxWidth: 700 }}>
      <Link to="/" style={{ color: "#6b7280", fontSize: "0.85rem" }}>
        ← All books
      </Link>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          // margin: "0.75rem 0 1.5rem",
        }}
      >
        <h1>
          {book.author}, <cite>{book.title.slice(0, 25)}...</cite>
        </h1>
        <StatusBadge status={book.status} />
      </div>

      {error && <p className="error-msg">{error}</p>}

      <div style={{ display: "grid", gap: "0.75rem" }}>
        {/* Step 1 */}
        <div className="card">
          <h3 style={{ margin: "0 0 0.5rem" }}>
            1 · OCR{ocrDone && " (Complete)"}
          </h3>
          {ocrDone ? (
            <p
              style={{
                margin: "0 0 0.75rem",
                color: "#065f46",
                fontSize: "0.875rem",
              }}
            >
              ✓ OCR complete. Upload a new PDF to re-run.
            </p>
          ) : (
            <p
              style={{
                margin: "0 0 0.75rem",
                color: "#6b7280",
                fontSize: "0.875rem",
              }}
            >
              Upload a PDF to run Mistral OCR and extract page-level markdown.
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            style={{ display: "none" }}
            onChange={handleUpload}
          />
          <button
            className={`btn ${ocrDone ? "btn-secondary" : "btn-primary"}`}
            disabled={!canUpload || uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? "Uploading…" : ocrDone ? "Restart OCR" : "Upload PDF"}
          </button>
        </div>

        {/* Step 2 */}
        <div className="card">
          <h3 style={{ margin: "0 0 0.5rem" }}>2 · Mark Segment Boundaries</h3>
          <p
            style={{
              margin: "0 0 0.5rem",
              color: "#6b7280",
              fontSize: "0.875rem",
            }}
          >
            Scroll through OCR pages, click lines to mark boundaries, exclude
            front/back matter.
          </p>
          {boundaryCount !== null && (
            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.8rem",
                color: boundaryCount > 0 ? "#065f46" : "#9ca3af",
              }}
            >
              {boundaryCount > 0
                ? `✓ ${boundaryCount} ${
                    boundaryCount === 1 ? "boundary" : "boundaries"
                  } defined`
                : "No boundaries defined yet"}
            </p>
          )}
          <button
            className="btn btn-primary"
            disabled={!canMark}
            onClick={() => navigate(`/books/${bookId}/boundaries`)}
          >
            Open Boundary Editor
          </button>
        </div>

        {/* Step 3 */}
        <div className="card">
          <h3 style={{ margin: "0 0 0.5rem" }}>3 · Embed</h3>
          <p
            style={{
              margin: "0 0 0.5rem",
              color: "#6b7280",
              fontSize: "0.875rem",
            }}
          >
            Chunk segments and generate 384-dim embeddings with IBM Granite.
          </p>
          {embedStats !== null && (
            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.8rem",
                color: embedStats.chunk_count > 0 ? "#065f46" : "#9ca3af",
              }}
            >
              {embedStats.chunk_count > 0
                ? `✓ ${embedStats.segment_count} segment${
                    embedStats.segment_count !== 1 ? "s" : ""
                  } → ${embedStats.chunk_count} chunk${
                    embedStats.chunk_count !== 1 ? "s" : ""
                  } embedded`
                : `${embedStats.segment_count} segment${
                    embedStats.segment_count !== 1 ? "s" : ""
                  } ready to embed`}
            </p>
          )}
          <button
            className="btn btn-primary"
            disabled={!canEmbed || book.status === "embedding"}
            onClick={handleEmbed}
          >
            {book.status === "embedding" ? "Embedding…" : "Run Embedding"}
          </button>
        </div>

        {/* Step 4 */}
        <div className="card">
          <h3 style={{ margin: "0 0 0.5rem" }}>4 · Cluster & Label</h3>
          <p
            style={{
              margin: "0 0 0.5rem",
              color: "#6b7280",
              fontSize: "0.875rem",
            }}
          >
            Run k-means++ clustering and generate Mistral tags per cluster.
          </p>
          {clusterStats !== null && (
            <div style={{ margin: "0 0 0.75rem" }}>
              <p
                style={{
                  margin: "0 0 0.25rem",
                  fontSize: "0.8rem",
                  color: "#065f46",
                }}
              >
                ✓ {clusterStats.parent_count} parent cluster
                {clusterStats.parent_count !== 1 ? "s" : ""}
                {clusterStats.subclusters.length > 0
                  ? ` · ${clusterStats.subclusters.length} split into subclusters`
                  : ""}
              </p>
              {clusterStats.subclusters.length > 0 && (
                <p style={{ margin: 0, fontSize: "0.75rem", color: "#6b7280" }}>
                  {clusterStats.subclusters
                    .map(
                      (s) =>
                        `Cluster ${s.parent_index}: ${s.child_count} sub${
                          s.child_count !== 1 ? "s" : ""
                        }`,
                    )
                    .join(" · ")}
                </p>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              className="btn btn-primary"
              disabled={
                !canCluster || ["clustering", "labeling"].includes(book.status)
              }
              onClick={handleCluster}
            >
              {book.status === "clustering"
                ? "Clustering…"
                : book.status === "labeling"
                  ? "Labeling…"
                  : "Run Clustering"}
            </button>
            {["clustered", "labeled"].includes(book.status) && (
              <button
                className="btn btn-secondary"
                onClick={() => navigate(`/books/${bookId}/clusters`)}
              >
                View Clusters
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
