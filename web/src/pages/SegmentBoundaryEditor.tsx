import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type BoundaryItem, type OcrPage } from "../api/client";

interface LocalBoundary extends BoundaryItem {
  _key: string; // page_index:line_index
}

function boundaryKey(pageIndex: number, lineIndex: number) {
  return `${pageIndex}:${lineIndex}`;
}

export default function SegmentBoundaryEditor() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  const [pages, setPages] = useState<OcrPage[]>([]);
  const [excludedPages, setExcludedPages] = useState<Set<number>>(new Set());
  const [boundaries, setBoundaries] = useState<LocalBoundary[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load pages and any saved draft
  useEffect(() => {
    Promise.all([api.books.pages(bookId!), api.boundaries.get(bookId!)])
      .then(([pagesData, draft]) => {
        setPages(pagesData);
        setExcludedPages(new Set(draft.excluded_pages));
        setBoundaries(
          draft.boundaries.map((b) => ({
            ...b,
            _key: boundaryKey(b.page_index, b.line_index),
          })),
        );
      })
      .catch((e) => setError(e.message));
  }, [bookId]);

  // Auto-save draft 800ms after changes
  const scheduleSave = useCallback(
    (newBoundaries: LocalBoundary[], newExcluded: Set<number>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          await api.boundaries.save(bookId!, {
            boundaries: newBoundaries.map(({ _key, ...b }) => b),
            excluded_pages: Array.from(newExcluded),
          });
        } catch (e: any) {
          setError(e.message);
        } finally {
          setSaving(false);
        }
      }, 800);
    },
    [bookId],
  );

  const toggleLine = (pageIndex: number, lineIndex: number) => {
    const key = boundaryKey(pageIndex, lineIndex);
    const exists = boundaries.find((b) => b._key === key);

    let updated: LocalBoundary[];
    if (exists) {
      updated = boundaries.filter((b) => b._key !== key);
    } else {
      const newBoundary: LocalBoundary = {
        boundary_index: 0, // re-indexed on save
        page_index: pageIndex,
        line_index: lineIndex,
        segment_title: "",
        _key: key,
      };
      updated = [...boundaries, newBoundary].sort(
        (a, b) => a.page_index - b.page_index || a.line_index - b.line_index,
      );
    }

    // Re-index
    updated = updated.map((b, i) => ({ ...b, boundary_index: i }));
    setBoundaries(updated);
    scheduleSave(updated, excludedPages);
  };

  const toggleExclude = (pageIndex: number) => {
    const next = new Set(excludedPages);
    if (next.has(pageIndex)) next.delete(pageIndex);
    else next.add(pageIndex);
    setExcludedPages(next);
    scheduleSave(boundaries, next);
  };

  const updateTitle = (key: string, title: string) => {
    const updated = boundaries.map((b) =>
      b._key === key ? { ...b, segment_title: title } : b,
    );
    setBoundaries(updated);
    scheduleSave(updated, excludedPages);
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await api.boundaries.save(bookId!, {
        boundaries: boundaries.map(({ _key, ...b }) => b),
        excluded_pages: Array.from(excludedPages),
      });
      await api.boundaries.confirm(bookId!);
      navigate(`/books/${bookId}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  };

  // Build live segment preview from current markers + excluded pages
  const segmentPreviews = boundaries.map((b, i) => {
    const nextB = boundaries[i + 1];
    const startLabel = `p${b.page_index + 1} line ${b.line_index + 1}`;
    const endLabel = nextB
      ? `p${nextB.page_index + 1} line ${nextB.line_index}`
      : "end";
    return {
      key: b._key,
      title: b.segment_title || `Segment ${i + 1}`,
      range: `${startLabel} → ${endLabel}`,
    };
  });

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 320px",
        gap: "1rem",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Left: pages */}
      <div style={{ overflowY: "auto", paddingRight: "0.5rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "1rem",
          }}
        >
          <Link
            to={`/books/${bookId}`}
            style={{ color: "#6b7280", fontSize: "0.85rem" }}
          >
            ← Back
          </Link>
          <h2 style={{ margin: 0, fontSize: "1rem" }}>
            Segment Boundary Editor
          </h2>
          {saving && (
            <span style={{ color: "#6b7280", fontSize: "0.75rem" }}>
              Saving…
            </span>
          )}
        </div>
        {error && <p className="error-msg">{error}</p>}

        {pages.map((page) => {
          const isExcluded = excludedPages.has(page.page_index);
          return (
            <div
              key={page.page_index}
              className="card"
              style={{
                marginBottom: "0.75rem",
                opacity: isExcluded ? 0.4 : 1,
                position: "relative",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.5rem",
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: "0.8rem",
                    color: "#6b7280",
                  }}
                >
                  Page {page.page_index + 1}
                </span>
                <button
                  className={`btn ${isExcluded ? "btn-secondary" : "btn-danger"}`}
                  style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }}
                  onClick={() => toggleExclude(page.page_index)}
                >
                  {isExcluded ? "Include" : "Exclude"}
                </button>
              </div>

              {!isExcluded &&
                page.lines.map((line, lineIdx) => {
                  const key = boundaryKey(page.page_index, lineIdx);
                  const isBoundary = boundaries.some((b) => b._key === key);
                  return (
                    <div key={lineIdx} style={{ position: "relative" }}>
                      {isBoundary && (
                        <div
                          style={{
                            borderTop: "2px solid #4f46e5",
                            marginBottom: "2px",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.65rem",
                              background: "#4f46e5",
                              color: "#fff",
                              padding: "0 0.3rem",
                              borderRadius: "3px",
                            }}
                          >
                            ▶{" "}
                            {boundaries.find((b) => b._key === key)
                              ?.segment_title || "Segment start"}
                          </span>
                        </div>
                      )}
                      <p
                        onClick={() => toggleLine(page.page_index, lineIdx)}
                        className="boundary-line"
                        style={{
                          margin: "1px 0",
                          padding: "2px 4px",
                          cursor: "pointer",
                          fontSize: "0.8rem",
                          lineHeight: 1.5,
                          borderRadius: "3px",
                          background: isBoundary ? "#eef2ff" : undefined,
                          minHeight: "1em",
                          whiteSpace: "pre-wrap",
                          userSelect: "none",
                        }}
                        data-line-label={`p${page.page_index + 1} · line ${lineIdx + 1}`}
                      >
                        {line || "\u00A0"}
                      </p>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>

      {/* Right: segment list */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h3 style={{ margin: 0, fontSize: "0.9rem" }}>
            {boundaries.length} segment{boundaries.length !== 1 ? "s" : ""}
          </h3>
          <button
            className="btn btn-success"
            disabled={boundaries.length === 0 || confirming}
            onClick={handleConfirm}
          >
            {confirming ? "Saving…" : "Confirm"}
          </button>
        </div>

        <p style={{ margin: 0, fontSize: "0.75rem", color: "#6b7280" }}>
          Click any line on a page to start a new segment there.
        </p>

        <div
          style={{
            overflowY: "auto",
            flex: 1,
            minHeight: 0,
            display: "grid",
            gap: "0.5rem",
            alignContent: "start",
          }}
        >
          {segmentPreviews.map((seg) => (
            <div
              key={seg.key}
              className="card"
              style={{ padding: "0.5rem 0.75rem" }}
            >
              <input
                value={
                  boundaries.find((b) => b._key === seg.key)?.segment_title ??
                  ""
                }
                placeholder={seg.title}
                onChange={(e) => updateTitle(seg.key, e.target.value)}
                style={{
                  width: "100%",
                  border: "none",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  padding: 0,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <span style={{ color: "#9ca3af", fontSize: "0.7rem" }}>
                {seg.range}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
