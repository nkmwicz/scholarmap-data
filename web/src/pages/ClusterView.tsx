import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Cluster } from "../api/client";

export default function ClusterView() {
  const { bookId } = useParams<{ bookId: string }>();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    api.clusters
      .list(bookId!)
      .then(setClusters)
      .catch((e) => setError(e.message));
  }, [bookId]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const top = clusters.filter((c) => !c.is_subcluster);
  const subMap = clusters.reduce<Record<string, Cluster[]>>((acc, c) => {
    if (c.is_subcluster && c.parent_cluster_id) {
      acc[c.parent_cluster_id] = [...(acc[c.parent_cluster_id] ?? []), c];
    }
    return acc;
  }, {});

  return (
    <div>
      <Link
        to={`/books/${bookId}`}
        style={{ color: "#6b7280", fontSize: "0.85rem" }}
      >
        ← Back
      </Link>
      <h2>Clusters</h2>
      {error && <p className="error-msg">{error}</p>}
      {clusters.length === 0 && (
        <p style={{ color: "#6b7280" }}>No clusters yet.</p>
      )}

      <div style={{ display: "grid", gap: "0.75rem" }}>
        {top.map((cluster) => (
          <div key={cluster.id} className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: "0.8rem",
                    color: "#6b7280",
                    marginRight: "0.5rem",
                  }}
                >
                  Cluster {cluster.cluster_index + 1}
                </span>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem",
                    marginTop: "0.4rem",
                  }}
                >
                  {cluster.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        background: "#ede9fe",
                        color: "#5b21b6",
                        padding: "0.15rem 0.55rem",
                        borderRadius: "9999px",
                        fontSize: "0.75rem",
                        fontWeight: 500,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <button
                className="btn btn-secondary"
                style={{
                  fontSize: "0.75rem",
                  padding: "0.25rem 0.6rem",
                  flexShrink: 0,
                }}
                onClick={() => toggle(cluster.id)}
              >
                {expanded.has(cluster.id)
                  ? "Hide"
                  : `${cluster.representative_samples.length} samples`}
              </button>
            </div>

            {expanded.has(cluster.id) && (
              <div
                style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}
              >
                {cluster.representative_samples.map((s) => (
                  <div
                    key={s.chunk_id}
                    style={{
                      background: "#f9fafb",
                      border: "1px solid #e5e7eb",
                      borderRadius: "6px",
                      padding: "0.6rem 0.75rem",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: "0.75rem",
                        color: "#374151",
                        marginBottom: "0.25rem",
                      }}
                    >
                      {s.segment_title}
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.8rem",
                        color: "#4b5563",
                        lineHeight: 1.5,
                      }}
                    >
                      {s.text.slice(0, 300)}
                      {s.text.length > 300 ? "…" : ""}
                    </p>
                  </div>
                ))}

                {(subMap[cluster.id] ?? []).map((sub) => (
                  <div
                    key={sub.id}
                    style={{
                      borderLeft: "3px solid #a5b4fc",
                      paddingLeft: "0.75rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.3rem",
                        marginBottom: "0.35rem",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.7rem",
                          color: "#6b7280",
                          marginRight: "0.25rem",
                        }}
                      >
                        sub:
                      </span>
                      {sub.tags.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            background: "#dbeafe",
                            color: "#1e40af",
                            padding: "0.1rem 0.45rem",
                            borderRadius: "9999px",
                            fontSize: "0.7rem",
                            fontWeight: 500,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {sub.representative_samples.slice(0, 2).map((s) => (
                      <p
                        key={s.chunk_id}
                        style={{
                          margin: "0.25rem 0",
                          fontSize: "0.75rem",
                          color: "#4b5563",
                        }}
                      >
                        {s.text.slice(0, 200)}…
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
