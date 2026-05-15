import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Cluster, type Segment } from "../api/client";

const col: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  minHeight: 0,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "#fff",
};

export default function ClusterView() {
  const { bookId } = useParams<{ bookId: string }>();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [selectedSub, setSelectedSub] = useState<Cluster | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [loadingSegs, setLoadingSegs] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.clusters
      .list(bookId!)
      .then(setClusters)
      .catch((e) => setError(e.message));
  }, [bookId]);

  const topClusters = clusters.filter((c) => !c.is_subcluster);
  const subMap = clusters.reduce<Record<string, Cluster[]>>((acc, c) => {
    if (c.is_subcluster && c.parent_cluster_id)
      acc[c.parent_cluster_id] = [...(acc[c.parent_cluster_id] ?? []), c];
    return acc;
  }, {});

  const fetchSegments = (clusterId: string) => {
    setLoadingSegs(true);
    setSelectedSegment(null);
    api.clusters
      .segments(bookId!, clusterId)
      .then((s) => {
        setSegments(s);
        setLoadingSegs(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoadingSegs(false);
      });
  };

  const selectCluster = (c: Cluster) => {
    setSelectedCluster(c);
    setSelectedSub(null);
    fetchSegments(c.id);
  };

  const selectSub = (sub: Cluster | null) => {
    setSelectedSub(sub);
    fetchSegments(sub ? sub.id : selectedCluster!.id);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100svh - 5rem)",
        gap: "0.5rem",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          flexShrink: 0,
        }}
      >
        <Link
          to={`/books/${bookId}`}
          style={{ color: "#6b7280", fontSize: "0.85rem" }}
        >
          ← Back
        </Link>
        <h2 style={{ margin: 0 }}>Explore Clusters</h2>
        {error && (
          <span className="error-msg" style={{ margin: 0 }}>
            {error}
          </span>
        )}
      </div>

      {/* Three-column body */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px 280px 1fr",
          gap: "0.75rem",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Column 1 — Cluster list */}
        <div style={col}>
          <div
            style={{
              padding: "0.6rem 0.75rem",
              borderBottom: "1px solid #e5e7eb",
              fontWeight: 600,
              fontSize: "0.8rem",
              color: "#374151",
              flexShrink: 0,
            }}
          >
            {topClusters.length} Clusters
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {topClusters.map((c) => (
              <button
                key={c.id}
                onClick={() => selectCluster(c)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background:
                    selectedCluster?.id === c.id ? "#ede9fe" : "transparent",
                  border: "none",
                  borderBottom: "1px solid #f3f4f6",
                  padding: "0.6rem 0.75rem",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: "#6b7280",
                    marginBottom: "0.3rem",
                  }}
                >
                  Cluster {c.cluster_index + 1}
                </div>
                <div
                  style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}
                >
                  {c.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        background: "#ede9fe",
                        color: "#5b21b6",
                        padding: "0.1rem 0.4rem",
                        borderRadius: 9999,
                        fontSize: "0.65rem",
                        fontWeight: 500,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Column 2 — Sub-cluster filter + letter list */}
        <div style={col}>
          {selectedCluster ? (
            <>
              {/* Sub-cluster filter */}
              {(subMap[selectedCluster.id] ?? []).length > 0 && (
                <div
                  style={{
                    padding: "0.5rem 0.75rem",
                    borderBottom: "1px solid #e5e7eb",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#6b7280",
                      marginBottom: "0.35rem",
                    }}
                  >
                    Filter by sub-cluster
                  </div>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}
                  >
                    <button
                      onClick={() => selectSub(null)}
                      style={{
                        padding: "0.15rem 0.5rem",
                        borderRadius: 9999,
                        fontSize: "0.7rem",
                        fontWeight: 500,
                        cursor: "pointer",
                        background: !selectedSub ? "#1e40af" : "#e5e7eb",
                        color: !selectedSub ? "#fff" : "#374151",
                        border: "none",
                      }}
                    >
                      All
                    </button>
                    {(subMap[selectedCluster.id] ?? []).map((sub) => (
                      <button
                        key={sub.id}
                        onClick={() => selectSub(sub)}
                        style={{
                          padding: "0.15rem 0.5rem",
                          borderRadius: 9999,
                          fontSize: "0.7rem",
                          fontWeight: 500,
                          cursor: "pointer",
                          background:
                            selectedSub?.id === sub.id ? "#1e40af" : "#e5e7eb",
                          color:
                            selectedSub?.id === sub.id ? "#fff" : "#374151",
                          border: "none",
                        }}
                      >
                        {sub.tags[0] ?? `Sub ${sub.cluster_index + 1}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Letter count */}
              <div
                style={{
                  padding: "0.4rem 0.75rem",
                  borderBottom: "1px solid #f3f4f6",
                  fontSize: "0.72rem",
                  color: "#6b7280",
                  flexShrink: 0,
                }}
              >
                {loadingSegs
                  ? "Loading…"
                  : `${segments.length} letter${
                      segments.length !== 1 ? "s" : ""
                    }`}
              </div>

              {/* Letter list */}
              <div style={{ overflowY: "auto", flex: 1 }}>
                {segments.map((seg) => (
                  <button
                    key={seg.id}
                    onClick={() => setSelectedSegment(seg)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      borderBottom: "1px solid #f3f4f6",
                      padding: "0.55rem 0.75rem",
                      cursor: "pointer",
                      background:
                        selectedSegment?.id === seg.id
                          ? "#f0f9ff"
                          : "transparent",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 500,
                        fontSize: "0.78rem",
                        color: "#111827",
                      }}
                    >
                      {seg.title || `Letter ${seg.segment_index + 1}`}
                    </div>
                    {seg.page_range.length > 0 && (
                      <div
                        style={{
                          fontSize: "0.68rem",
                          color: "#9ca3af",
                          marginTop: "0.1rem",
                        }}
                      >
                        p. {seg.page_range[0]}–
                        {seg.page_range[seg.page_range.length - 1]}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div
              style={{
                padding: "1rem",
                color: "#9ca3af",
                fontSize: "0.85rem",
              }}
            >
              Select a cluster to browse letters.
            </div>
          )}
        </div>

        {/* Column 3 — Full letter */}
        <div style={col}>
          {selectedSegment ? (
            <>
              <div
                style={{
                  padding: "0.75rem 1rem",
                  borderBottom: "1px solid #e5e7eb",
                  flexShrink: 0,
                }}
              >
                <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem" }}>
                  {selectedSegment.title ||
                    `Letter ${selectedSegment.segment_index + 1}`}
                </h3>
                {selectedSegment.page_range.length > 0 && (
                  <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                    Pages {selectedSegment.page_range[0]}–
                    {
                      selectedSegment.page_range[
                        selectedSegment.page_range.length - 1
                      ]
                    }
                  </span>
                )}
              </div>
              <div
                style={{
                  overflowY: "auto",
                  flex: 1,
                  padding: "1rem 1.25rem",
                  fontFamily: "Georgia, serif",
                  fontSize: "0.9rem",
                  lineHeight: 1.8,
                  color: "#1f2937",
                  whiteSpace: "pre-wrap",
                }}
              >
                {selectedSegment.markdown}
              </div>
            </>
          ) : (
            <div
              style={{
                padding: "1rem",
                color: "#9ca3af",
                fontSize: "0.85rem",
              }}
            >
              Select a letter to read it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
