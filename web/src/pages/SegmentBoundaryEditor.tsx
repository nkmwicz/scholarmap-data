import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  api,
  type BoundaryItem,
  type ExcludedLineItem,
  type OcrPage,
} from "../api/client";

interface LocalBoundary extends BoundaryItem {
  _key: string; // page_index:line_index
}

function boundaryKey(pageIndex: number, lineIndex: number) {
  return `${pageIndex}:${lineIndex}`;
}

// ---------------------------------------------------------------------------
// PageCard — memoized so only the affected page re-renders on state changes
// ---------------------------------------------------------------------------

interface PageCardProps {
  page: OcrPage;
  isExcluded: boolean;
  boundaries: LocalBoundary[];
  excludedLines: Set<string>;
  dragKeys: Set<string>;
  onToggleExclude: (pageIndex: number) => void;
  onToggleLine: (pageIndex: number, lineIndex: number) => void;
  onLineMouseDown: (
    pageIndex: number,
    lineIndex: number,
    e: React.MouseEvent<HTMLParagraphElement>,
  ) => void;
  onLineMouseEnter: (pageIndex: number, lineIndex: number) => void;
}

const PageCard = memo(
  function PageCard({
    page,
    isExcluded,
    boundaries,
    excludedLines,
    dragKeys,
    onToggleExclude,
    onToggleLine,
    onLineMouseDown,
    onLineMouseEnter,
  }: PageCardProps) {
    return (
      <div
        className="card"
        style={{ opacity: isExcluded ? 0.4 : 1, position: "relative" }}
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
            style={{ fontWeight: 600, fontSize: "0.8rem", color: "#6b7280" }}
          >
            Page {page.page_index + 1}
          </span>
          <button
            className={`btn ${isExcluded ? "btn-secondary" : "btn-danger"}`}
            style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }}
            onClick={() => onToggleExclude(page.page_index)}
          >
            {isExcluded ? "Include" : "Exclude"}
          </button>
        </div>

        {!isExcluded &&
          page.lines.map((line, lineIdx) => {
            const key = boundaryKey(page.page_index, lineIdx);
            const isBoundary = boundaries.some((b) => b._key === key);
            const isLineExcluded = excludedLines.has(key);
            const isDragging = dragKeys.has(key);
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
                      {boundaries.find((b) => b._key === key)?.segment_title ||
                        "Segment start"}
                    </span>
                  </div>
                )}
                <p
                  onClick={() => onToggleLine(page.page_index, lineIdx)}
                  onMouseDown={(e) =>
                    onLineMouseDown(page.page_index, lineIdx, e)
                  }
                  onMouseEnter={() =>
                    onLineMouseEnter(page.page_index, lineIdx)
                  }
                  onContextMenu={(e) => {
                    if (e.ctrlKey) e.preventDefault();
                  }}
                  className="boundary-line"
                  style={{
                    margin: "1px 0",
                    padding: "2px 4px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    lineHeight: 1.5,
                    borderRadius: "3px",
                    background: isBoundary
                      ? "#eef2ff"
                      : isDragging
                        ? "#fef9c3"
                        : undefined,
                    outline: isDragging ? "1px solid #fbbf24" : undefined,
                    textDecoration: isLineExcluded ? "line-through" : undefined,
                    color: isLineExcluded ? "#ef4444" : undefined,
                    opacity: isLineExcluded ? 0.6 : undefined,
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
  },
  // Custom comparator: skip re-render if nothing relevant to THIS page changed
  (prev, next) => {
    if (prev.isExcluded !== next.isExcluded) return false;
    if (prev.onToggleExclude !== next.onToggleExclude) return false;
    if (prev.onToggleLine !== next.onToggleLine) return false;
    if (prev.onLineMouseDown !== next.onLineMouseDown) return false;
    if (prev.onLineMouseEnter !== next.onLineMouseEnter) return false;

    if (prev.boundaries !== next.boundaries) {
      const pi = prev.page.page_index;
      const prevBs = prev.boundaries.filter((b) => b.page_index === pi);
      const nextBs = next.boundaries.filter((b) => b.page_index === pi);
      if (prevBs.length !== nextBs.length) return false;
      for (let i = 0; i < prevBs.length; i++) {
        if (
          prevBs[i]._key !== nextBs[i]._key ||
          prevBs[i].segment_title !== nextBs[i].segment_title
        )
          return false;
      }
    }

    if (prev.excludedLines !== next.excludedLines) {
      for (let li = 0; li < prev.page.lines.length; li++) {
        const key = `${prev.page.page_index}:${li}`;
        if (prev.excludedLines.has(key) !== next.excludedLines.has(key))
          return false;
      }
    }

    if (prev.dragKeys !== next.dragKeys) {
      for (let li = 0; li < prev.page.lines.length; li++) {
        const key = `${prev.page.page_index}:${li}`;
        if (prev.dragKeys.has(key) !== next.dragKeys.has(key)) return false;
      }
    }

    return true;
  },
);

// ---------------------------------------------------------------------------
// Main editor component
// ---------------------------------------------------------------------------

export default function SegmentBoundaryEditor() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  // Remove .main's max-width/centering while the editor is mounted
  useEffect(() => {
    const main = document.querySelector(".main");
    main?.classList.add("main--editor");
    return () => main?.classList.remove("main--editor");
  }, []);

  const [pages, setPages] = useState<OcrPage[]>([]);
  const [excludedPages, setExcludedPages] = useState<Set<number>>(new Set());
  const [excludedLines, setExcludedLines] = useState<Set<string>>(new Set());
  const [boundaries, setBoundaries] = useState<LocalBoundary[]>([]);
  const savingRef = useRef<HTMLSpanElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag-select for line exclusion (Ctrl+right-click drag)
  const dragRef = useRef<{
    adding: boolean;
    startKey: string;
    currentKeys: Set<string>;
  } | null>(null);
  const [dragKeys, setDragKeys] = useState<Set<string>>(new Set());

  // Ref mirrors for stale-closure-free handlers
  const stateRef = useRef({ excludedLines, boundaries, excludedPages });
  const allLineKeysRef = useRef<{
    keys: string[];
    indexMap: Map<string, number>;
  }>({
    keys: [],
    indexMap: new Map(),
  });

  // Load pages and any saved draft
  useEffect(() => {
    Promise.all([api.books.pages(bookId!), api.boundaries.get(bookId!)])
      .then(([pagesData, draft]) => {
        setPages(pagesData);
        setExcludedPages(new Set(draft.excluded_pages));
        setExcludedLines(
          new Set(
            (draft.excluded_lines ?? []).map((l) =>
              boundaryKey(l.page_index, l.line_index),
            ),
          ),
        );
        setBoundaries(
          draft.boundaries.map((b) => ({
            ...b,
            _key: boundaryKey(b.page_index, b.line_index),
          })),
        );
      })
      .catch((e) => setError(e.message));
  }, [bookId]);

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = { excludedLines, boundaries, excludedPages };
  }, [excludedLines, boundaries, excludedPages]);

  // Flat ordered list of visible line keys + O(1) index map for drag-range lookup
  const allLineKeyData = useMemo(() => {
    const keys: string[] = [];
    for (const page of pages) {
      if (!excludedPages.has(page.page_index)) {
        for (let li = 0; li < page.lines.length; li++) {
          keys.push(boundaryKey(page.page_index, li));
        }
      }
    }
    const indexMap = new Map<string, number>(keys.map((k, i) => [k, i]));
    return { keys, indexMap };
  }, [pages, excludedPages]);

  useEffect(() => {
    allLineKeysRef.current = allLineKeyData;
  }, [allLineKeyData]);

  // Auto-save draft 800ms after changes
  const scheduleSave = useCallback(
    (
      newBoundaries: LocalBoundary[],
      newExcluded: Set<number>,
      newExcludedLines: Set<string>,
    ) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (savingRef.current) savingRef.current.style.visibility = "visible";
        try {
          await api.boundaries.save(bookId!, {
            boundaries: newBoundaries.map(({ _key, ...b }) => b),
            excluded_pages: Array.from(newExcluded),
            excluded_lines: Array.from(newExcludedLines).map((key) => {
              const [pi, li] = key.split(":").map(Number);
              return { page_index: pi, line_index: li } as ExcludedLineItem;
            }),
          });
        } catch (e: any) {
          setError(e.message);
        } finally {
          if (savingRef.current) savingRef.current.style.visibility = "hidden";
        }
      }, 800);
    },
    [bookId],
  );

  // Global mouseup: commit accumulated drag range
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button !== 2 || !dragRef.current) return;
      const { adding, currentKeys } = dragRef.current;
      dragRef.current = null;
      setDragKeys(new Set());
      if (currentKeys.size === 0) return;
      const {
        excludedLines: cur,
        boundaries: curB,
        excludedPages: curP,
      } = stateRef.current;
      const next = new Set(cur);
      currentKeys.forEach((key) => {
        if (adding) next.add(key);
        else next.delete(key);
      });
      setExcludedLines(next);
      scheduleSave(curB, curP, next);
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [scheduleSave]);

  // Stable callbacks — read current state via stateRef to avoid stale closures
  // and to keep references stable across renders (enabling React.memo to work)
  const toggleLine = useCallback(
    (pageIndex: number, lineIndex: number) => {
      const {
        boundaries: cur,
        excludedPages: curP,
        excludedLines: curEL,
      } = stateRef.current;
      const key = boundaryKey(pageIndex, lineIndex);
      const exists = cur.find((b) => b._key === key);
      let updated: LocalBoundary[];
      if (exists) {
        updated = cur.filter((b) => b._key !== key);
      } else {
        const newBoundary: LocalBoundary = {
          boundary_index: 0,
          page_index: pageIndex,
          line_index: lineIndex,
          segment_title: "",
          _key: key,
        };
        updated = [...cur, newBoundary].sort(
          (a, b) => a.page_index - b.page_index || a.line_index - b.line_index,
        );
      }
      updated = updated.map((b, i) => ({ ...b, boundary_index: i }));
      setBoundaries(updated);
      scheduleSave(updated, curP, curEL);
    },
    [scheduleSave],
  );

  const toggleExclude = useCallback(
    (pageIndex: number) => {
      const {
        boundaries: curB,
        excludedLines: curEL,
        excludedPages: curP,
      } = stateRef.current;
      const next = new Set(curP);
      if (next.has(pageIndex)) next.delete(pageIndex);
      else next.add(pageIndex);
      setExcludedPages(next);
      scheduleSave(curB, next, curEL);
    },
    [scheduleSave],
  );

  const handleLineMouseDown = useCallback(
    (
      pageIndex: number,
      lineIndex: number,
      e: React.MouseEvent<HTMLParagraphElement>,
    ) => {
      if (e.button === 2 && e.ctrlKey) {
        e.preventDefault();
        const key = boundaryKey(pageIndex, lineIndex);
        const adding = !stateRef.current.excludedLines.has(key);
        dragRef.current = {
          adding,
          startKey: key,
          currentKeys: new Set([key]),
        };
        setDragKeys(new Set([key]));
      }
    },
    [],
  );

  const handleLineMouseEnter = useCallback(
    (pageIndex: number, lineIndex: number) => {
      if (!dragRef.current) return;
      const endKey = boundaryKey(pageIndex, lineIndex);
      const { keys, indexMap } = allLineKeysRef.current;
      const startIdx = indexMap.get(dragRef.current.startKey);
      const endIdx = indexMap.get(endKey);
      if (startIdx === undefined || endIdx === undefined) return;
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      const range = new Set(keys.slice(lo, hi + 1));
      dragRef.current.currentKeys = range;
      setDragKeys(range);
    },
    [],
  );

  const updateTitle = (key: string, title: string) => {
    const updated = boundaries.map((b) =>
      b._key === key ? { ...b, segment_title: title } : b,
    );
    setBoundaries(updated);
    scheduleSave(updated, excludedPages, excludedLines);
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await api.boundaries.save(bookId!, {
        boundaries: boundaries.map(({ _key, ...b }) => b),
        excluded_pages: Array.from(excludedPages),
        excluded_lines: Array.from(excludedLines).map((key) => {
          const [pi, li] = key.split(":").map(Number);
          return { page_index: pi, line_index: li } as ExcludedLineItem;
        }),
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

  // Virtualizer — only renders the page cards currently in the viewport
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 600,
    overscan: 5,
  });

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 220px",
        gap: "1rem",
        height: "100%",
        overflow: "hidden",
        padding: "1rem",
        boxSizing: "border-box",
      }}
    >
      {/* Left: pages */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Header — fixed, does not scroll with page list */}
        <div
          style={{
            flexShrink: 0,
            paddingRight: "0.5rem",
            marginBottom: "1rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <Link
              to={`/books/${bookId}`}
              style={{ color: "#6b7280", fontSize: "0.85rem" }}
            >
              ← Back
            </Link>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>
              Segment Boundary Editor
            </h2>
            <span
              ref={savingRef}
              style={{
                visibility: "hidden",
                color: "#6b7280",
                fontSize: "0.75rem",
              }}
            >
              Saving…
            </span>
          </div>
          {error && <p className="error-msg">{error}</p>}
        </div>

        {/* Virtualized scroll container */}
        <div
          ref={parentRef}
          style={{
            overflowY: "scroll",
            flex: 1,
            minHeight: 0,
            scrollbarGutter: "stable",
          }}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((vRow) => {
              const page = pages[vRow.index];
              return (
                <div
                  key={vRow.key}
                  data-index={vRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vRow.start}px)`,
                    paddingBottom: "0.75rem",
                  }}
                >
                  <PageCard
                    page={page}
                    isExcluded={excludedPages.has(page.page_index)}
                    boundaries={boundaries}
                    excludedLines={excludedLines}
                    dragKeys={dragKeys}
                    onToggleExclude={toggleExclude}
                    onToggleLine={toggleLine}
                    onLineMouseDown={handleLineMouseDown}
                    onLineMouseEnter={handleLineMouseEnter}
                  />
                </div>
              );
            })}
          </div>
        </div>
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
          Click any line to start a new segment. Ctrl+right-click to exclude a
          line; Ctrl+right-click and drag to exclude a range.
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
