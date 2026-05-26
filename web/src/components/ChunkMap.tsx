import { useRef, useState } from "react";
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
}

export function ChunkedSegmentText({
  chunks,
  clusters,
  activeParentIndex,
  activeSubIndex,
  highlightChunkId,
}: ChunkedTextProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
            {/* Cluster badge — top right (hidden for non-matched chunks in search mode) */}
            {chunk.cluster_labels.length > 0 &&
              !(highlightChunkId !== undefined && !isHighlighted) && (
                <span
                  style={{
                    float: "right",
                    marginLeft: "0.6rem",
                    marginBottom: "0.15rem",
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
            <p
              style={{
                margin: 0,
                fontFamily: "Georgia, serif",
                fontSize: "0.9rem",
                lineHeight: 1.8,
                color: "#1f2937",
                whiteSpace: "pre-wrap",
              }}
            >
              {chunk.text}
            </p>

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
                padding: "0.15rem 0.45rem",
                borderRadius: 5,
                fontSize: "0.68rem",
                fontWeight: isHighlighted ? 700 : 500,
                background: isHovered ? color.border : color.bg,
                border: `1px solid ${isChunkActive(chunk.cluster_labels, activeParentIndex, activeSubIndex) ? color.border : "#e5e7eb"}`,
                color: color.text,
                cursor: onChunkClick ? "pointer" : "default",
                outline: isHighlighted ? `2px solid ${color.text}` : undefined,
                outlineOffset: isHighlighted ? "1px" : undefined,
                transition: "background 0.1s",
              }}
            >
              {chunk.chunk_index + 1}
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
