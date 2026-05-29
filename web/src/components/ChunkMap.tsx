import { useRef, useState } from "react";
import { api } from "../api/client";
import type {
  Cluster,
  ClusterLabel,
  SegmentChunkWithLabels,
} from "../api/client";

// A fixed soft-colour palette indexed by parent cluster_index
const PALETTE = [
  { bg: "#bfdbfe", border: "#93c5fd", text: "#1e40af" }, // blue
  { bg: "#bbf7d0", border: "#86efac", text: "#166534" }, // green
  { bg: "#fde68a", border: "#fcd34d", text: "#92400e" }, // amber
  { bg: "#f9a8d4", border: "#f472b6", text: "#9d174d" }, // pink
  { bg: "#ddd6fe", border: "#c4b5fd", text: "#5b21b6" }, // violet
  { bg: "#fed7aa", border: "#fdba74", text: "#9a3412" }, // orange
  { bg: "#a5f3fc", border: "#67e8f9", text: "#155e75" }, // cyan
  { bg: "#d9f99d", border: "#bef264", text: "#3f6212" }, // lime
  { bg: "#fecaca", border: "#fca5a5", text: "#991b1b" }, // red
  { bg: "#e9d5ff", border: "#d8b4fe", text: "#6b21a8" }, // purple
];

export function clusterColor(parentIndex: number) {
  return PALETTE[parentIndex % PALETTE.length];
}

/** Return the primary (lowest-index) parent_index for a chunk's label list. */
export function primaryClusterIndex(labels: ClusterLabel[]): number | null {
  if (labels.length === 0) return null;
  return labels.reduce(
    (min, l) => (l.parent_index < min ? l.parent_index : min),
    labels[0].parent_index,
  );
}

/** Returns true if a chunk matches the active cluster filter. */
function isChunkActive(
  labels: ClusterLabel[],
  activeParentIndex: number | undefined,
  activeSubIndex: number | null | undefined,
): boolean {
  if (activeParentIndex === undefined) return true;
  return labels.some(
    (l) =>
      l.parent_index === activeParentIndex &&
      (activeSubIndex === undefined || l.sub_index === activeSubIndex),
  );
}

interface ChunkedTextProps {
  chunks: SegmentChunkWithLabels[];
  clusters: Cluster[];
  activeParentIndex?: number;
  activeSubIndex?: number | null;
  highlightChunkId?: string;
  bookId?: string;
  onChunkPatch?: (
    chunkId: string,
    field: "neo4j_entered" | "unimportant",
    value: boolean,
  ) => void;
  onFindSimilar?: (chunkId: string) => void;
  gallicaUrl?: string | null;
  gallicaOffset?: number | null;
}

export function ChunkedSegmentText({
  chunks,
  clusters,
  activeParentIndex,
  activeSubIndex,
  highlightChunkId,
  bookId,
  onChunkPatch,
  onFindSimilar,
  gallicaUrl,
  gallicaOffset,
}: ChunkedTextProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [togglingChunk, setTogglingChunk] = useState<string | null>(null);

  const handleChunkToggle = async (
    e: React.MouseEvent,
    chunk: SegmentChunkWithLabels,
    field: "neo4j_entered" | "unimportant",
  ) => {
    e.stopPropagation();
    if (!bookId || !onChunkPatch) return;
    setTogglingChunk(chunk.chunk_id + field);
    try {
      const newVal = !chunk[field];
      await api.chunks.patch(bookId, chunk.chunk_id, { [field]: newVal });
      onChunkPatch(chunk.chunk_id, field, newVal);
    } catch {
      // silently ignore
    } finally {
      setTogglingChunk(null);
    }
  };

  const clusterByIndex = new Map<number, Cluster>();
  for (const c of clusters) {
    if (!c.is_subcluster) clusterByIndex.set(c.cluster_index, c);
  }

  if (chunks.length === 0) return null;

  return (
    <div
      style={{
        overflowY: "auto",
        flex: 1,
        minHeight: 0,
        padding: "0.75rem 1.25rem",
      }}
    >
      {chunks.map((chunk) => {
        const primary = primaryClusterIndex(chunk.cluster_labels);
        const clusterCol =
          primary !== null
            ? clusterColor(primary)
            : { bg: "#f9fafb", border: "#e5e7eb", text: "#6b7280" };
        const neutral = { bg: "#f9fafb", border: "#e5e7eb", text: "#6b7280" };
        const isHovered = hoveredId === chunk.chunk_id;
        const isHighlighted = highlightChunkId === chunk.chunk_id;
        // When a specific chunk is highlighted (search mode), non-matching chunks
        // stay neutral — only the matched chunk gets cluster color.
        const color =
          highlightChunkId !== undefined && !isHighlighted
            ? neutral
            : clusterCol;
        const active = isChunkActive(
          chunk.cluster_labels,
          activeParentIndex,
          activeSubIndex,
        );
        const dimmed = !active;

        const labelStr = chunk.cluster_labels
          .map((lbl) =>
            lbl.sub_index !== null
              ? `${lbl.parent_index + 1}(${lbl.sub_index + 1})`
              : `${lbl.parent_index + 1}`,
          )
          .join(" · ");

        const popoverTags = chunk.cluster_labels.map((lbl) => {
          const cluster = clusterByIndex.get(lbl.parent_index);
          return {
            label:
              lbl.sub_index !== null
                ? `${lbl.parent_index + 1}(${lbl.sub_index + 1})`
                : `${lbl.parent_index + 1}`,
            tags: cluster?.tags.slice(0, 4).join(" · ") ?? "—",
            color: clusterColor(lbl.parent_index),
          };
        });

        return (
          <div
            key={chunk.chunk_id}
            onMouseEnter={() => setHoveredId(chunk.chunk_id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              position: "relative",
              borderLeft: `3px solid ${isHighlighted ? color.border : active ? color.border : "#e5e7eb"}`,
              background: isHighlighted
                ? color.bg
                : active
                  ? isHovered
                    ? color.bg
                    : `${color.bg}66`
                  : isHovered
                    ? "#f3f4f6"
                    : "transparent",
              borderRadius: "0 4px 4px 0",
              padding: "0.45rem 0.75rem 0.45rem 0.65rem",
              marginBottom: "0.5rem",
              boxShadow: isHighlighted
                ? `inset 3px 0 0 ${color.border}, 0 0 0 1px ${color.border}44`
                : undefined,
              transition: "background 0.15s",
            }}
          >
            {/* Top-left: find similar button */}
            {onFindSimilar && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFindSimilar(chunk.chunk_id);
                }}
                title="Find similar chunks"
                style={{
                  float: "left",
                  marginRight: "0.5rem",
                  marginTop: "0.25rem",
                  width: 18,
                  height: 18,
                  flexShrink: 0,
                  borderRadius: "50%",
                  border: "1px solid #d1d5db",
                  background: "#f9fafb",
                  cursor: "pointer",
                  fontSize: "0.7rem",
                  color: "#6b7280",
                  padding: 0,
                  lineHeight: "16px",
                  textAlign: "center",
                }}
              >
                ≈
              </button>
            )}
            {/* Top-right badge row: flags + cluster badge */}
            <div
              style={{
                float: "right",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                marginLeft: "0.6rem",
                marginBottom: "0.15rem",
              }}
            >
              {/* Neo4j chunk toggle (only when bookId+onChunkPatch provided) */}
              {bookId && onChunkPatch && (
                <button
                  onClick={(e) => handleChunkToggle(e, chunk, "neo4j_entered")}
                  disabled={togglingChunk === chunk.chunk_id + "neo4j_entered"}
                  title={
                    chunk.neo4j_entered
                      ? "Mark chunk as not in Neo4j"
                      : "Mark chunk as in Neo4j"
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.2rem",
                    padding: "0.05rem 0.35rem",
                    fontSize: "0.62rem",
                    fontWeight: chunk.neo4j_entered ? 600 : 400,
                    border: `1px solid ${chunk.neo4j_entered ? "#059669" : "#e5e7eb"}`,
                    borderRadius: 4,
                    background: chunk.neo4j_entered ? "#ecfdf5" : "#f9fafb",
                    color: chunk.neo4j_entered ? "#059669" : "#9ca3af",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    lineHeight: 1,
                  }}
                >
                  {chunk.neo4j_entered ? "✔️" : "◯"} Neo4j
                </button>
              )}
              {/* Unimportant chunk toggle */}
              {bookId && onChunkPatch && (
                <button
                  onClick={(e) => handleChunkToggle(e, chunk, "unimportant")}
                  disabled={togglingChunk === chunk.chunk_id + "unimportant"}
                  title={
                    chunk.unimportant
                      ? "Mark chunk as important"
                      : "Mark chunk as unimportant"
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.2rem",
                    padding: "0.05rem 0.35rem",
                    fontSize: "0.62rem",
                    fontWeight: chunk.unimportant ? 600 : 400,
                    border: `1px solid ${chunk.unimportant ? "#dc2626" : "#e5e7eb"}`,
                    borderRadius: 4,
                    background: chunk.unimportant ? "#fef2f2" : "#f9fafb",
                    color: chunk.unimportant ? "#dc2626" : "#9ca3af",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    lineHeight: 1,
                  }}
                >
                  {chunk.unimportant ? "✗" : "◯"} Unimp.
                </button>
              )}
              {/* Cluster badge */}
              {chunk.cluster_labels.length > 0 &&
                !(highlightChunkId !== undefined && !isHighlighted) && (
                  <span
                    style={{
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      fontFamily: "monospace",
                      background: color.bg,
                      color: color.text,
                      border: `1px solid ${color.border}`,
                      padding: "0.05rem 0.35rem",
                      borderRadius: 4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {labelStr}
                  </span>
                )}
            </div>
            <p
              style={{
                margin: 0,
                fontFamily: "Georgia, serif",
                fontSize: "0.9rem",
                lineHeight: 1.8,
                color: chunk.unimportant ? "#9ca3af" : "#1f2937",
                whiteSpace: "pre-wrap",
                textDecoration: chunk.unimportant ? "line-through" : undefined,
              }}
            >
              {chunk.text}
            </p>

            {/* Gallica URL box — chapters only, when gallicaUrl provided */}
            {gallicaUrl &&
              gallicaOffset != null &&
              chunk.page_range.length > 0 && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.3rem 0.5rem",
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: 4,
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.15rem",
                  }}
                >
                  {chunk.page_range.map((page) => (
                    <span
                      key={page}
                      style={{
                        fontSize: "0.68rem",
                        fontFamily: "monospace",
                        color: "#374151",
                        wordBreak: "break-all",
                        userSelect: "all",
                      }}
                    >
                      {`${gallicaUrl.replace(/\/$/, "")}/f${page + gallicaOffset}.highres`}
                    </span>
                  ))}
                </div>
              )}

            {/* Hover popover — cluster details */}
            {isHovered && popoverTags.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "100%",
                  marginTop: 4,
                  zIndex: 50,
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                  padding: "0.55rem 0.75rem",
                  minWidth: 180,
                  maxWidth: 280,
                  pointerEvents: "none",
                }}
              >
                {popoverTags.map((pt, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.35rem",
                      marginBottom: i < popoverTags.length - 1 ? "0.25rem" : 0,
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        padding: "0.1rem 0.35rem",
                        borderRadius: 4,
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        fontFamily: "monospace",
                        background: pt.color.bg,
                        color: pt.color.text,
                        border: `1px solid ${pt.color.border}`,
                      }}
                    >
                      {pt.label}
                    </span>
                    <span
                      style={{
                        fontSize: "0.68rem",
                        color: "#374151",
                        lineHeight: 1.4,
                      }}
                    >
                      {pt.tags}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  chunks: SegmentChunkWithLabels[];
  clusters: Cluster[];
  /** chunk_id to ring-highlight (current chunk in chapter view) */
  highlightChunkId?: string;
  activeParentIndex?: number;
  activeSubIndex?: number | null;
  /** called when user clicks a chunk box */
  onChunkClick?: (chunk: SegmentChunkWithLabels) => void;
}

interface Popover {
  chunkIdx: number;
  x: number;
  y: number;
}

export function ChunkMap({
  chunks,
  clusters,
  highlightChunkId,
  activeParentIndex,
  activeSubIndex,
  onChunkClick,
}: Props) {
  const [popover, setPopover] = useState<Popover | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  if (chunks.length === 0) return null;

  // Build a map: parent_index → Cluster (only top-level)
  const clusterByIndex = new Map<number, Cluster>();
  for (const c of clusters) {
    if (!c.is_subcluster) clusterByIndex.set(c.cluster_index, c);
  }

  const showPopover = (e: React.MouseEvent, idx: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPopover({
      chunkIdx: idx,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const activeChunk = popover !== null ? chunks[popover.chunkIdx] : null;

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", userSelect: "none" }}
      onMouseLeave={() => setPopover(null)}
    >
      {/* Strip of chunk boxes */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "3px",
          padding: "0.5rem 0.75rem",
          borderBottom: "1px solid #e5e7eb",
          background: "#fafafa",
        }}
      >
        {chunks.map((chunk, i) => {
          const primary = primaryClusterIndex(chunk.cluster_labels);
          const color =
            primary !== null
              ? clusterColor(primary)
              : { bg: "#f3f4f6", border: "#e5e7eb", text: "#6b7280" };
          const isHighlighted = chunk.chunk_id === highlightChunkId;
          const isHovered = popover?.chunkIdx === i;
          return (
            <div
              key={chunk.chunk_id}
              onMouseEnter={(e) => showPopover(e, i)}
              onClick={() => onChunkClick?.(chunk)}
              style={{
                position: "relative",
                padding: "0.15rem 0.45rem",
                borderRadius: 5,
                fontSize: "0.68rem",
                fontWeight: isHighlighted ? 700 : 500,
                background: chunk.unimportant
                  ? "#fef2f2"
                  : isHovered
                    ? color.border
                    : color.bg,
                border: `1px solid ${
                  chunk.unimportant
                    ? "#fca5a5"
                    : isChunkActive(
                          chunk.cluster_labels,
                          activeParentIndex,
                          activeSubIndex,
                        )
                      ? color.border
                      : "#e5e7eb"
                }`,
                color: chunk.unimportant ? "#dc2626" : color.text,
                cursor: onChunkClick ? "pointer" : "default",
                outline: isHighlighted ? `2px solid ${color.text}` : undefined,
                outlineOffset: isHighlighted ? "1px" : undefined,
                transition: "background 0.1s",
              }}
            >
              {chunk.chunk_index + 1}
              {chunk.neo4j_entered && (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    fontSize: "0.5rem",
                    fontWeight: 700,
                    background: "#059669",
                    color: "#fff",
                    borderRadius: "50%",
                    width: 10,
                    height: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  N
                </span>
              )}
              {chunk.unimportant && (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    left: -4,
                    fontSize: "0.5rem",
                    fontWeight: 700,
                    background: "#dc2626",
                    color: "#fff",
                    borderRadius: "50%",
                    width: 10,
                    height: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  ✗
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Hover popover */}
      {popover !== null && activeChunk && (
        <div
          style={{
            position: "absolute",
            left: Math.min(popover.x + 8, 400),
            top: popover.y + 8,
            zIndex: 50,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            padding: "0.55rem 0.75rem",
            minWidth: 180,
            maxWidth: 280,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "#374151",
              marginBottom: "0.3rem",
            }}
          >
            Chunk {activeChunk.chunk_index + 1}
            {activeChunk.page_range.length > 0 &&
              ` · pp. ${activeChunk.page_range[0] + 1}–${activeChunk.page_range[activeChunk.page_range.length - 1] + 1}`}
          </div>
          {activeChunk.cluster_labels.length === 0 ? (
            <span style={{ fontSize: "0.68rem", color: "#9ca3af" }}>
              No cluster assigned
            </span>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              {activeChunk.cluster_labels.map((lbl, i) => {
                const cluster = clusterByIndex.get(lbl.parent_index);
                const color = clusterColor(lbl.parent_index);
                const label =
                  lbl.sub_index !== null
                    ? `${lbl.parent_index + 1}(${lbl.sub_index + 1})`
                    : `${lbl.parent_index + 1}`;
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.35rem",
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        padding: "0.1rem 0.35rem",
                        borderRadius: 4,
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        background: color.bg,
                        color: color.text,
                        border: `1px solid ${color.border}`,
                        fontFamily: "monospace",
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        fontSize: "0.68rem",
                        color: "#374151",
                        lineHeight: 1.4,
                      }}
                    >
                      {cluster?.tags.slice(0, 4).join(" · ") ?? "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
