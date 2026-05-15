import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Book } from "../api/client";
import StatusBadge from "../components/StatusBadge";

export default function BookDetail() {
  const { bookId } = useParams<{ bookId: string }>();
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
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
  }, [bookId]);

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
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleCluster = async () => {
    try {
      await api.clusters.trigger(bookId!);
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
  const canEmbed = ["segments_complete", "embedded"].includes(book.status);
  const canCluster = ["embedded", "clustered", "labeled"].includes(book.status);

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
          margin: "0.75rem 0 1.5rem",
        }}
      >
        <h1 style={{ margin: 0 }}>{book.title}</h1>
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
              margin: "0 0 0.75rem",
              color: "#6b7280",
              fontSize: "0.875rem",
            }}
          >
            Scroll through OCR pages, click lines to mark boundaries, exclude
            front/back matter.
          </p>
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
              margin: "0 0 0.75rem",
              color: "#6b7280",
              fontSize: "0.875rem",
            }}
          >
            Chunk segments and generate 768-dim embeddings with IBM Granite.
          </p>
          <button
            className="btn btn-primary"
            disabled={!canEmbed}
            onClick={handleEmbed}
          >
            Run Embedding
          </button>
        </div>

        {/* Step 4 */}
        <div className="card">
          <h3 style={{ margin: "0 0 0.5rem" }}>4 · Cluster & Label</h3>
          <p
            style={{
              margin: "0 0 0.75rem",
              color: "#6b7280",
              fontSize: "0.875rem",
            }}
          >
            Run k-means++ clustering and generate Mistral tags per cluster.
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              className="btn btn-primary"
              disabled={!canCluster}
              onClick={handleCluster}
            >
              Run Clustering
            </button>
            {book.status === "labeled" && (
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
