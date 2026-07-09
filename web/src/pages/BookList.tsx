import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  type Book,
  type DocumentType,
  type SearchResult,
  type Segment,
  type SegmentChunkWithLabels,
} from "../api/client";
import StatusBadge from "../components/StatusBadge";
import {
  ChunkMap,
  ChunkedSegmentText,
  clusterColor,
  primaryClusterIndex,
} from "../components/ChunkMap";
import { PanZoom } from "../components/PanZoom";
import { SegmentSummaryPanel } from "../components/SegmentSummaryPanel";
import { Neo4jToggleButton } from "../components/Neo4jToggleButton";

export default function BookList() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Search
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(
    null,
  );
  const [searchError, setSearchError] = useState("");
  const [similarLabel, setSimilarLabel] = useState<string | null>(null);

  // Viewer modal (opened when a search result is clicked)
  type ViewerState = {
    result: SearchResult;
    segment: Segment | null;
    book: Book | null;
    segmentChunks: SegmentChunkWithLabels[];
    loading: boolean;
    pageIdx: number;
    viewMode: "text" | "images" | "summary";
  };
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    slug: "",
    title: "",
    author: "",
    year: "",
    volume_number: "",
    description: "",
    document_type: "letters" as DocumentType,
  });
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    api.books
      .list()
      .then(setBooks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleExport = async () => {
    setExporting(true);
    setError("");
    try {
      await api.backup.export();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    setError("");
    setImportResult(null);
    try {
      const result = await api.backup.import(file);
      setImportResult(`Imported ${result.imported_books} book${result.imported_books !== 1 ? "s" : ""}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const book = await api.books.create({
        ...form,
        volume_number: form.volume_number
          ? parseInt(form.volume_number, 10)
          : undefined,
        author: form.author || undefined,
        year: form.year || undefined,
        description: form.description || undefined,
      });
      navigate(`/books/${book.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const results = await api.search.query(searchInput.trim());
      setSearchResults(results);
    } catch (e: any) {
      setSearchError(e.message);
    } finally {
      setSearching(false);
    }
  };

  const runSimilar = async (chunkId: string, label: string) => {
    setSearching(true);
    setSearchError("");
    setSimilarLabel(label);
    setSearchInput("");
    try {
      const results = await api.search.similar(chunkId);
      setSearchResults(results);
    } catch (e: any) {
      setSearchError(e.message);
      setSimilarLabel(null);
    } finally {
      setSearching(false);
    }
  };

  const handleSimilar = (r: SearchResult, e: React.MouseEvent) => {
    e.stopPropagation();
    runSimilar(
      r.chunk_id,
      `"${r.segment_title || `Letter ${r.segment_index + 1}`}" (${r.book_title})`,
    );
  };

  const openViewer = (r: SearchResult) => {
    setViewer({
      result: r,
      segment: null,
      book: null,
      segmentChunks: [],
      loading: true,
      pageIdx: 0,
      viewMode: "text",
    });
    Promise.all([
      api.segments.get(r.book_id, r.segment_id),
      api.books.get(r.book_id),
      api.segments.chunks(r.book_id, r.segment_id).catch(() => []),
    ])
      .then(([seg, book, chunks]) => {
        setViewer(
          (v) =>
            v && {
              ...v,
              segment: seg,
              book,
              segmentChunks: chunks,
              loading: false,
            },
        );
      })
      .catch(() => {
        setViewer((v) => v && { ...v, loading: false });
      });
  };

  return (
    <>
      <div>
        {/* ── Vector search bar ── */}
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <form
            onSubmit={handleSearch}
            style={{ display: "flex", gap: "0.5rem" }}
          >
            <input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                if (!e.target.value.trim()) setSearchResults(null);
              }}
              placeholder="Search across all letters and chapters…"
              style={{
                flex: 1,
                padding: "0.45rem 0.65rem",
                fontSize: "0.9rem",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
              }}
            />
            <button className="btn btn-primary" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
            {searchResults !== null && (
              <button
                type="button"
                onClick={() => {
                  setSearchResults(null);
                  setSearchInput("");
                  setSimilarLabel(null);
                }}
                style={{
                  padding: "0.45rem 0.75rem",
                  fontSize: "0.85rem",
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            )}
          </form>
          {searchError && (
            <p className="error-msg" style={{ margin: "0.5rem 0 0" }}>
              {searchError}
            </p>
          )}
        </div>

        {/* ── Search results ── */}
        {searchResults !== null && (
          <div style={{ marginBottom: "2rem" }}>
            <div
              style={{
                fontSize: "0.8rem",
                color: "#6b7280",
                marginBottom: "0.75rem",
              }}
            >
              {searchResults.length === 0
                ? "No results found."
                : similarLabel
                  ? `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} similar to ${similarLabel}`
                  : `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} for "${searchInput}"`}
            </div>
            <div style={{ display: "grid", gap: "0.65rem" }}>
              {searchResults.map((r) => (
                <div
                  key={r.chunk_id}
                  onClick={() => openViewer(r)}
                  style={{ textDecoration: "none", cursor: "pointer" }}
                >
                  <div
                    className="card"
                    style={{
                      padding: "0.75rem 1rem",
                      borderLeft: `3px solid ${
                        primaryClusterIndex(r.cluster_labels) !== null
                          ? clusterColor(primaryClusterIndex(r.cluster_labels)!)
                              .border
                          : "#a78bfa"
                      }`,
                    }}
                  >
                    {/* Header row */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "1rem",
                        marginBottom: "0.3rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.4rem",
                        }}
                      >
                        <button
                          title="Find similar chunks"
                          onClick={(e) => handleSimilar(r, e)}
                          style={{
                            flexShrink: 0,
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            border: "1px solid #d1d5db",
                            background: "#f9fafb",
                            cursor: "pointer",
                            fontSize: "0.7rem",
                            color: "#6b7280",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 0,
                            lineHeight: 1,
                          }}
                        >
                          ≈
                        </button>
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: "0.9rem",
                            color: "#111",
                          }}
                        >
                          {r.segment_title || `Letter ${r.segment_index + 1}`}
                        </span>
                        {r.neo4j_entered && (
                          <span
                            style={{
                              fontSize: "0.62rem",
                              padding: "0.1rem 0.4rem",
                              borderRadius: 4,
                              border: "1px solid #059669",
                              background: "#ecfdf5",
                              color: "#059669",
                              fontWeight: 600,
                            }}
                          >
                            ✔ Neo4j
                          </span>
                        )}
                        {r.unimportant && (
                          <span
                            style={{
                              fontSize: "0.62rem",
                              padding: "0.1rem 0.4rem",
                              borderRadius: 4,
                              border: "1px solid #dc2626",
                              background: "#fef2f2",
                              color: "#dc2626",
                              fontWeight: 600,
                            }}
                          >
                            ✗ Unimportant
                          </span>
                        )}
                        <span
                          style={{
                            color: "#6b7280",
                            fontSize: "0.78rem",
                          }}
                        >
                          {r.book_title}
                          {r.book_author && ` — ${r.book_author}`}
                          {r.book_year && ` (${r.book_year})`}
                        </span>
                      </div>
                      {/* Relevance bar */}
                      <div
                        style={{
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: "0.4rem",
                        }}
                      >
                        <div
                          style={{
                            width: 60,
                            height: 5,
                            background: "#e5e7eb",
                            borderRadius: 9999,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${Math.round(r.score * 100)}%`,
                              background: "#7c3aed",
                              borderRadius: 9999,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: "0.68rem",
                            color: "#7c3aed",
                            fontWeight: 600,
                          }}
                        >
                          {Math.round(r.score * 100)}%
                        </span>
                      </div>
                    </div>
                    {/* Cluster labels */}
                    {r.cluster_labels.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          gap: "0.3rem",
                          flexWrap: "wrap",
                          marginBottom: "0.4rem",
                        }}
                      >
                        {r.cluster_labels.map((lbl, i) => {
                          const color = clusterColor(lbl.parent_index);
                          return (
                            <span
                              key={i}
                              style={{
                                fontSize: "0.65rem",
                                padding: "0.1rem 0.45rem",
                                borderRadius: 9999,
                                background: color.bg,
                                color: color.text,
                                border: `1px solid ${color.border}`,
                              }}
                            >
                              {lbl.sub_index !== null
                                ? `${lbl.parent_index + 1}(${lbl.sub_index + 1})`
                                : `${lbl.parent_index + 1}`}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {/* Chunk text */}
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.78rem",
                        color: r.unimportant ? "#9ca3af" : "#374151",
                        lineHeight: 1.6,
                        fontFamily: "Georgia, serif",
                        textDecoration: r.unimportant
                          ? "line-through"
                          : undefined,
                      }}
                    >
                      {r.chunk_text.length > 300
                        ? r.chunk_text.slice(0, 300) + "…"
                        : r.chunk_text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h1 style={{ margin: 0 }}>Books</h1>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button
              className="btn btn-secondary"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? "Exporting…" : "Export Backup"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => importRef.current?.click()}
              disabled={importing}
            >
              {importing ? "Importing…" : "Import Backup"}
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json,.gz,.json.gz"
              style={{ display: "none" }}
              onChange={handleImport}
            />
            <button
              className="btn btn-primary"
              onClick={() => setShowForm(!showForm)}
            >
              {showForm ? "Cancel" : "+ New Book"}
            </button>
          </div>
        </div>
        {importResult && (
          <p style={{ color: "#059669", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
            {importResult}
          </p>
        )}

        {showForm && (
          <div
            className="card"
            style={{ marginBottom: "1.5rem", maxWidth: 480 }}
          >
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Slug (unique ID)</label>
                <input
                  required
                  placeholder="ribier_v1"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Title</label>
                <input
                  required
                  placeholder="Lettres de Ribier"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Author</label>
                <input
                  placeholder="Jean-Paul Ribier"
                  value={form.author}
                  onChange={(e) => setForm({ ...form, author: e.target.value })}
                />
              </div>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Year</label>
                  <input
                    placeholder="1642–1658"
                    value={form.year}
                    onChange={(e) => setForm({ ...form, year: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Volume #</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="1"
                    value={form.volume_number}
                    onChange={(e) =>
                      setForm({ ...form, volume_number: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Description</label>
                <input
                  placeholder="Optional notes about this source"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>Document Type</label>
                <select
                  value={form.document_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      document_type: e.target.value as DocumentType,
                    })
                  }
                >
                  <option value="letters">Letters</option>
                  <option value="chapters">Chapters</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {error && <p className="error-msg">{error}</p>}
              <button className="btn btn-primary" disabled={creating}>
                {creating ? "Creating…" : "Create Book"}
              </button>
            </form>
          </div>
        )}

        {loading && <p>Loading…</p>}
        {!loading && books.length === 0 && (
          <p>No books yet. Create one to get started.</p>
        )}

        <div style={{ display: "grid", gap: "0.75rem" }}>
          {books.map((book) => (
            <Link
              key={book.id}
              to={`/books/${book.id}`}
              style={{ textDecoration: "none" }}
            >
              <div
                className="card"
                style={{ padding: 0, overflow: "hidden" }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "1rem 1.25rem",
                  }}
                >
                  <div>
                    <strong>{book.title}</strong>
                    {book.author && (
                      <span
                        style={{
                          color: "#374151",
                          fontSize: "0.85rem",
                          marginLeft: "0.5rem",
                        }}
                      >
                        — {book.author}
                      </span>
                    )}
                    {book.year && (
                      <span
                        style={{
                          color: "#6b7280",
                          fontSize: "0.8rem",
                          marginLeft: "0.4rem",
                        }}
                      >
                        ({book.year})
                      </span>
                    )}
                    {book.volume_number != null && (
                      <span
                        style={{
                          color: "#6b7280",
                          fontSize: "0.8rem",
                          marginLeft: "0.4rem",
                        }}
                      >
                        vol. {book.volume_number}
                      </span>
                    )}
                    <span
                      style={{
                        color: "#6b7280",
                        fontSize: "0.8rem",
                        marginLeft: "0.5rem",
                      }}
                    >
                      {book.slug}
                    </span>
                    <span
                      style={{
                        color: "#9ca3af",
                        fontSize: "0.75rem",
                        marginLeft: "0.75rem",
                      }}
                    >
                      {book.document_type}
                    </span>
                  </div>
                  <StatusBadge status={book.status} />
                </div>
                {book.chunk_total > 0 && (
                  <div style={{ height: 4, background: "#e5e7eb" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.round((book.chunk_done / book.chunk_total) * 100)}%`,
                        background: "#7c3aed",
                      }}
                    />
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Search result viewer modal ── */}
      {viewer && (
        <div
          onClick={() => setViewer(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 10,
              boxShadow: "0 8px 40px rgba(0,0,0,0.22)",
              width: "min(860px, 94vw)",
              height: "min(88vh, 820px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Modal header */}
            <div
              style={{
                padding: "0.75rem 1rem",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "1rem",
                flexShrink: 0,
              }}
            >
              <div>
                <h3 style={{ margin: "0 0 0.2rem", fontSize: "1rem" }}>
                  {viewer.result.segment_title ||
                    `Letter ${viewer.result.segment_index + 1}`}
                </h3>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  {viewer.result.book_title}
                  {viewer.result.book_author &&
                    ` — ${viewer.result.book_author}`}
                  {viewer.result.book_year && ` (${viewer.result.book_year})`}
                  {viewer.result.page_range.length > 0 &&
                    ` · pp. ${viewer.result.page_range[0] + 1}–${viewer.result.page_range[viewer.result.page_range.length - 1] + 1}`}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  flexShrink: 0,
                }}
              >
                {/* Tab toggle — always show; images tab only if gallica available */}
                <div
                  style={{
                    display: "flex",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    overflow: "hidden",
                  }}
                >
                  {(
                    [
                      "text",
                      ...(viewer.book?.gallica_url ? ["images"] : []),
                      "summary",
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode}
                      onClick={() =>
                        setViewer(
                          (v) =>
                            v && {
                              ...v,
                              viewMode: mode as "text" | "images" | "summary",
                            },
                        )
                      }
                      style={{
                        padding: "0.2rem 0.65rem",
                        fontSize: "0.72rem",
                        fontWeight: 500,
                        border: "none",
                        cursor: "pointer",
                        background:
                          viewer.viewMode === mode ? "#1e40af" : "transparent",
                        color: viewer.viewMode === mode ? "#fff" : "#374151",
                      }}
                    >
                      {mode === "text"
                        ? "OCR Text"
                        : mode === "images"
                          ? "Images"
                          : "Summary"}
                    </button>
                  ))}
                </div>
                {viewer.segment && (
                  <Neo4jToggleButton
                    segment={viewer.segment}
                    bookId={viewer.result.book_id}
                    onUpdate={(updated) =>
                      setViewer((v) => v && { ...v, segment: updated })
                    }
                  />
                )}
                <button
                  onClick={() => setViewer(null)}
                  style={{
                    padding: "0.25rem 0.6rem",
                    fontSize: "0.85rem",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal body */}
            {viewer.loading ? (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#9ca3af",
                }}
              >
                Loading…
              </div>
            ) : viewer.segment ? (
              <>
                {/* Images panel */}
                {viewer.viewMode === "images" && viewer.book?.gallica_url && (
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    {viewer.segment.page_range.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.25rem 0.6rem",
                          borderBottom: "1px solid #e5e7eb",
                          flexShrink: 0,
                        }}
                      >
                        <button
                          onClick={() =>
                            setViewer(
                              (v) =>
                                v && {
                                  ...v,
                                  pageIdx: Math.max(0, v.pageIdx - 1),
                                },
                            )
                          }
                          disabled={viewer.pageIdx === 0}
                          style={{
                            padding: "0.15rem 0.5rem",
                            fontSize: "0.8rem",
                            border: "1px solid #e5e7eb",
                            borderRadius: 4,
                            background:
                              viewer.pageIdx === 0 ? "#f9fafb" : "#fff",
                            color: viewer.pageIdx === 0 ? "#d1d5db" : "#374151",
                            cursor:
                              viewer.pageIdx === 0 ? "default" : "pointer",
                          }}
                        >
                          ◀
                        </button>
                        <span
                          style={{
                            fontSize: "0.72rem",
                            color: "#6b7280",
                            flex: 1,
                            textAlign: "center",
                          }}
                        >
                          Folio{" "}
                          {viewer.segment.page_range[viewer.pageIdx] +
                            (viewer.book.gallica_offset ?? 0)}{" "}
                          <span style={{ color: "#9ca3af" }}>
                            ({viewer.pageIdx + 1} /{" "}
                            {viewer.segment.page_range.length})
                          </span>
                        </span>
                        <button
                          onClick={() =>
                            setViewer(
                              (v) =>
                                v && {
                                  ...v,
                                  pageIdx: Math.min(
                                    v.segment!.page_range.length - 1,
                                    v.pageIdx + 1,
                                  ),
                                },
                            )
                          }
                          disabled={
                            viewer.pageIdx ===
                            viewer.segment.page_range.length - 1
                          }
                          style={{
                            padding: "0.15rem 0.5rem",
                            fontSize: "0.8rem",
                            border: "1px solid #e5e7eb",
                            borderRadius: 4,
                            background:
                              viewer.pageIdx ===
                              viewer.segment.page_range.length - 1
                                ? "#f9fafb"
                                : "#fff",
                            color:
                              viewer.pageIdx ===
                              viewer.segment.page_range.length - 1
                                ? "#d1d5db"
                                : "#374151",
                            cursor:
                              viewer.pageIdx ===
                              viewer.segment.page_range.length - 1
                                ? "default"
                                : "pointer",
                          }}
                        >
                          ▶
                        </button>
                      </div>
                    )}
                    <PanZoom
                      key={`${viewer.result.segment_id}-${viewer.pageIdx}`}
                    >
                      {viewer.segment.page_range.map((page, i) => {
                        const folio = page + (viewer.book!.gallica_offset ?? 0);
                        const url = `${viewer.book!.gallica_url!.replace(/\/$/, "")}/f${folio}.highres`;
                        return (
                          <div
                            key={page}
                            style={{
                              display: i === viewer.pageIdx ? "block" : "none",
                            }}
                          >
                            <img
                              src={url}
                              alt={`Folio ${folio}`}
                              style={{
                                width: "100%",
                                display: "block",
                                pointerEvents: "none",
                              }}
                              draggable={false}
                            />
                          </div>
                        );
                      })}
                    </PanZoom>
                  </div>
                )}
                {/* Text panel */}
                {viewer.viewMode === "text" && (
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                    }}
                  >
                    {viewer.segmentChunks.length > 0 && (
                      <div
                        style={{
                          padding: "0.5rem 1rem 0.25rem",
                          borderBottom: "1px solid #e5e7eb",
                          flexShrink: 0,
                        }}
                      >
                        <ChunkMap
                          chunks={viewer.segmentChunks}
                          clusters={[]}
                          highlightChunkId={viewer.result.chunk_id}
                        />
                      </div>
                    )}
                    {viewer.segmentChunks.length > 0 ? (
                      <ChunkedSegmentText
                        chunks={viewer.segmentChunks}
                        clusters={[]}
                        highlightChunkId={viewer.result.chunk_id}
                        {...(viewer.segment?.document_type === "chapters" && {
                          bookId: viewer.result.book_id,
                          onChunkPatch: (chunkId, field, value) =>
                            setViewer(
                              (v) =>
                                v && {
                                  ...v,
                                  segmentChunks: v.segmentChunks.map((c) =>
                                    c.chunk_id === chunkId
                                      ? { ...c, [field]: value }
                                      : c,
                                  ),
                                },
                            ),
                          getPageUrl: (page: number) => {
                            const b = viewer.book;
                            return b?.gallica_url && b.gallica_offset != null
                              ? `${b.gallica_url}/f${page + b.gallica_offset!}.highres`
                              : null;
                          },
                        })}
                        onFindSimilar={(chunkId) => {
                          setViewer(null);
                          runSimilar(
                            chunkId,
                            `"${viewer.result.segment_title || `Letter ${viewer.result.segment_index + 1}`}" (${viewer.result.book_title})`,
                          );
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          flex: 1,
                          overflowY: "auto",
                          padding: "1rem 1.25rem",
                          fontFamily: "Georgia, serif",
                          fontSize: "0.9rem",
                          lineHeight: 1.8,
                          color: "#1f2937",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {viewer.segment.markdown}
                      </div>
                    )}
                  </div>
                )}
                {viewer.viewMode === "summary" && (
                  <SegmentSummaryPanel
                    segment={viewer.segment}
                    bookId={viewer.result.book_id}
                    onUpdate={(updated) =>
                      setViewer((v) => v && { ...v, segment: updated })
                    }
                    gallicaUrl={viewer.book?.gallica_url}
                    gallicaOffset={viewer.book?.gallica_offset}
                  />
                )}
              </>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#9ca3af",
                }}
              >
                Failed to load segment.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
