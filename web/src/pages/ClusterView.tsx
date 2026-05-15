import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Book, type Cluster, type Segment } from "../api/client";
import { PanZoom } from "../components/PanZoom";

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
  const [book, setBook] = useState<Book | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [selectedSub, setSelectedSub] = useState<Cluster | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [loadingSegs, setLoadingSegs] = useState(false);

  const [viewMode, setViewMode] = useState<"text" | "images">("text");
  const [pageIdx, setPageIdx] = useState(0);
  const [clusterBarOpen, setClusterBarOpen] = useState(true);
  // Gallica calibration
  const [gallicaBannerOpen, setGallicaBannerOpen] = useState(true);
  const [firstSegmentPage, setFirstSegmentPage] = useState<number | null>(null);
  const [firstSegmentTitle, setFirstSegmentTitle] = useState("");
  const [firstSegmentMarkdown, setFirstSegmentMarkdown] = useState("");
  const [gallicaUrl, setGallicaUrl] = useState("");
  const [gallicaFolio, setGallicaFolio] = useState("");
  const [savingGallica, setSavingGallica] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPageIdx(0);
  }, [selectedSegment?.id]);

  useEffect(() => {
    api.books
      .get(bookId!)
      .then(setBook)
      .catch((e) => setError(e.message));
    api.clusters
      .list(bookId!)
      .then(setClusters)
      .catch((e) => setError(e.message));
    api.segments
      .list(bookId!)
      .then((segs) => {
        if (segs.length > 0) {
          const first = segs[0];
          setFirstSegmentPage(first.page_range[0] ?? 0);
          setFirstSegmentTitle(
            first.title || `Letter ${first.segment_index + 1}`,
          );
          setFirstSegmentMarkdown(first.markdown || "");
        }
      })
      .catch(() => {});
  }, [bookId]);

  const saveGallica = async () => {
    if (!gallicaUrl || !gallicaFolio || firstSegmentPage === null) return;
    const folio = parseInt(gallicaFolio, 10);
    if (isNaN(folio)) return;
    const offset = folio - firstSegmentPage;
    setSavingGallica(true);
    try {
      const updated = await api.books.setGallica(
        bookId!,
        gallicaUrl.trim(),
        offset,
      );
      setBook(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingGallica(false);
    }
  };

  const gallicaPageUrl = (page: number) =>
    book?.gallica_url && book.gallica_offset !== null
      ? `${book.gallica_url}/f${page + book.gallica_offset!}.highres`
      : null;

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

  const selectSub = (sub: Cluster) => {
    setSelectedSub(sub);
    setSelectedCluster(
      clusters.find((c) => c.id === sub.parent_cluster_id) ?? null,
    );
    fetchSegments(sub.id);
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

      {/* Gallica calibration banner */}
      {book && !book.gallica_url && !gallicaBannerOpen && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: 8,
            flexShrink: 0,
            padding: "0.35rem 0.75rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.75rem",
            color: "#92400e",
          }}
        >
          <span>Gallica image viewer not configured.</span>
          <button
            onClick={() => setGallicaBannerOpen(true)}
            style={{
              marginLeft: "auto",
              fontSize: "0.72rem",
              padding: "0.15rem 0.55rem",
              background: "#d97706",
              color: "#fff",
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            Set up
          </button>
        </div>
      )}
      {book && !book.gallica_url && gallicaBannerOpen && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: 8,
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "1fr 300px",
            overflow: "hidden",
          }}
        >
          {/* Left: first letter OCR text */}
          <div
            style={{
              borderRight: "1px solid #fcd34d",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "0.4rem 0.75rem",
                borderBottom: "1px solid #fde68a",
                fontSize: "0.7rem",
                fontWeight: 600,
                color: "#92400e",
                flexShrink: 0,
              }}
            >
              {firstSegmentTitle
                ? `"${firstSegmentTitle}" — OCR page ${
                    firstSegmentPage !== null ? firstSegmentPage + 1 : "?"
                  }`
                : "Loading first letter..."}
            </div>
            <div
              style={{
                overflowY: "auto",
                flex: 1,
                padding: "0.6rem 0.75rem",
                fontFamily: "Georgia, serif",
                fontSize: "0.78rem",
                lineHeight: 1.7,
                color: "#1f2937",
                whiteSpace: "pre-wrap",
              }}
            >
              {firstSegmentMarkdown || "Loading..."}
            </div>
          </div>

          {/* Right: form */}
          <div
            style={{
              padding: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.55rem",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                fontSize: "0.8rem",
                color: "#92400e",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
              }}
            >
              Set up Gallica image viewer
              <button
                onClick={() => setGallicaBannerOpen(false)}
                title="Collapse"
                style={{
                  marginLeft: "auto",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "#92400e",
                  fontSize: "0.9rem",
                  lineHeight: 1,
                  padding: "0 0.1rem",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: "0.75rem", color: "#78350f" }}>
              {firstSegmentPage !== null
                ? `First letter “${firstSegmentTitle}” starts at OCR page ${firstSegmentPage + 1}.`
                : "Loading first segment…"}
            </div>
            <input
              type="text"
              placeholder="https://gallica.bnf.fr/ark:/12148/btv1b8626747s"
              value={gallicaUrl}
              onChange={(e) => setGallicaUrl(e.target.value)}
              style={{
                padding: "0.2rem 0.4rem",
                fontSize: "0.72rem",
                border: "1px solid #fcd34d",
                borderRadius: 6,
              }}
            />
            <div
              style={{
                fontSize: "0.65rem",
                color: "#a16207",
                marginTop: "-0.3rem",
              }}
            >
              e.g. https://gallica.bnf.fr/ark:/12148/btv1b8626747s
            </div>
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
            >
              <label
                style={{
                  fontSize: "0.75rem",
                  color: "#78350f",
                  whiteSpace: "nowrap",
                }}
              >
                Gallica folio for OCR page{" "}
                {firstSegmentPage !== null ? firstSegmentPage + 1 : "?"}
              </label>
              <input
                type="number"
                placeholder="e.g. 8"
                value={gallicaFolio}
                onChange={(e) => setGallicaFolio(e.target.value)}
                style={{
                  width: 70,
                  padding: "0.3rem 0.5rem",
                  fontSize: "0.78rem",
                  border: "1px solid #fcd34d",
                  borderRadius: 6,
                }}
              />
            </div>
            <button
              onClick={saveGallica}
              disabled={savingGallica || !gallicaUrl || !gallicaFolio}
              style={{
                padding: "0.3rem 0.9rem",
                fontSize: "0.78rem",
                fontWeight: 600,
                background: "#d97706",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                opacity:
                  savingGallica || !gallicaUrl || !gallicaFolio ? 0.5 : 1,
              }}
            >
              {savingGallica ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Browser body */}
      {(!book || !!book.gallica_url || !gallicaBannerOpen) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Selected cluster strip */}
          {(selectedCluster || selectedSub) &&
            (() => {
              const active = selectedSub ?? selectedCluster!;
              const parentIdx = selectedCluster!.cluster_index + 1;
              const subIdx = selectedSub
                ? (subMap[selectedCluster!.id]?.findIndex(
                    (s) => s.id === selectedSub.id,
                  ) ?? -1) + 1
                : null;
              const label = subIdx ? `${parentIdx}(${subIdx})` : `${parentIdx}`;
              return (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.25rem 0.75rem",
                    background: selectedSub ? "#ede9fe" : "#f5f3ff",
                    border: `1px solid ${selectedSub ? "#c4b5fd" : "#ddd6fe"}`,
                    borderRadius: 9999,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: "0.72rem",
                      color: "#5b21b6",
                      flexShrink: 0,
                    }}
                  >
                    {label}
                  </span>
                  <span style={{ fontSize: "0.72rem", color: "#374151" }}>
                    {active.tags.slice(0, 5).join(" · ")}
                  </span>
                </div>
              );
            })()}

          {/* Cluster bar */}
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              flexShrink: 0,
              alignItems: "flex-start",
            }}
          >
            {/* Toggle button — fixed width */}
            <div style={{ flexShrink: 0 }}>
              <button
                onClick={() => setClusterBarOpen((o) => !o)}
                style={{
                  padding: "0.2rem 0.55rem",
                  fontSize: "0.68rem",
                  fontWeight: 600,
                  background: "#f3f4f6",
                  color: "#6b7280",
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  width: "6rem",
                }}
                title={clusterBarOpen ? "Hide clusters" : "Show clusters"}
              >
                {clusterBarOpen ? "▲" : "▼"} Clusters
              </button>
            </div>
            {/* Cluster pills — flex-1, height controlled by open/collapsed */}
            <div
              style={{
                display: "flex",
                flex: 1,
                gap: "0.35rem",
                flexWrap: "wrap",
                alignItems: "flex-start",
                overflow: "hidden",
                maxHeight: clusterBarOpen ? "20rem" : "2rem",
                transition: "max-height 0.2s ease",
              }}
            >
              {topClusters.map((c) => {
                const isActive = selectedCluster?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => selectCluster(c)}
                    style={{
                      padding: "0.2rem 0.65rem",
                      fontSize: "0.72rem",
                      fontWeight: isActive ? 600 : 400,
                      background: isActive ? "#ede9fe" : "#f9fafb",
                      color: isActive ? "#5b21b6" : "#374151",
                      border: `1px solid ${isActive ? "#c4b5fd" : "#e5e7eb"}`,
                      borderRadius: 9999,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      style={{
                        color: isActive ? "#a78bfa" : "#9ca3af",
                        fontSize: "0.65rem",
                        marginRight: "0.3rem",
                      }}
                    >
                      {c.cluster_index + 1}
                    </span>
                    {c.tags.slice(0, 2).join(" · ")}
                  </button>
                );
              })}
              {selectedCluster &&
                (subMap[selectedCluster.id]?.length ?? 0) > 0 && (
                  <select
                    value={selectedSub?.id ?? ""}
                    onChange={(e) => {
                      if (e.target.value === "") {
                        selectCluster(selectedCluster);
                      } else {
                        const sub = subMap[selectedCluster.id].find(
                          (s) => s.id === e.target.value,
                        );
                        if (sub) selectSub(sub);
                      }
                    }}
                    style={{
                      fontSize: "0.72rem",
                      padding: "0.2rem 0.5rem",
                      border: "1px solid #c4b5fd",
                      borderRadius: 6,
                      background: "#faf5ff",
                      color: "#5b21b6",
                      cursor: "pointer",
                      marginLeft: "0.25rem",
                    }}
                  >
                    <option value="">All letters in cluster</option>
                    {subMap[selectedCluster.id].map((sub, i) => (
                      <option key={sub.id} value={sub.id}>
                        Sub {i + 1}: {sub.tags[0] ?? "—"}
                      </option>
                    ))}
                  </select>
                )}
            </div>
          </div>

          {/* Body: letter list + letter view */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "280px 1fr",
              gap: "0.75rem",
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {/* Letter list */}
            <div style={col}>
              {selectedCluster || selectedSub ? (
                <>
                  <div
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderBottom: "1px solid #e5e7eb",
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        color: "#374151",
                      }}
                    >
                      {selectedSub
                        ? (selectedSub.tags[0] ?? "Sub-cluster")
                        : `Cluster ${
                            (selectedCluster?.cluster_index ?? 0) + 1
                          } — all letters`}
                    </div>
                    <div
                      style={{
                        fontSize: "0.68rem",
                        color: "#9ca3af",
                        marginTop: "0.1rem",
                      }}
                    >
                      {loadingSegs
                        ? "Loading…"
                        : `${segments.length} letter${
                            segments.length !== 1 ? "s" : ""
                          }`}
                    </div>
                  </div>
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
                        {(seg.cluster_labels?.length ?? 0) > 0 && (
                          <div
                            style={{
                              marginTop: "0.25rem",
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "0.2rem",
                            }}
                          >
                            {seg.cluster_labels?.map((lbl, i) => (
                              <span
                                key={i}
                                style={{
                                  background: "#f3f4f6",
                                  color: "#374151",
                                  padding: "0.05rem 0.35rem",
                                  borderRadius: 9999,
                                  fontSize: "0.62rem",
                                  fontFamily: "monospace",
                                }}
                              >
                                {lbl.sub_index !== null
                                  ? `${lbl.parent_index + 1}(${lbl.sub_index + 1})`
                                  : `${lbl.parent_index + 1}`}
                              </span>
                            ))}
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
                  Select a cluster above to browse letters.
                </div>
              )}
            </div>

            {/* Letter view */}
            <div style={col}>
              {selectedSegment ? (
                <>
                  <div
                    style={{
                      padding: "0.75rem 1rem",
                      borderBottom: "1px solid #e5e7eb",
                      flexShrink: 0,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "1rem",
                    }}
                  >
                    <div>
                      <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem" }}>
                        {selectedSegment.title ||
                          `Letter ${selectedSegment.segment_index + 1}`}
                      </h3>
                      {selectedSegment.page_range.length > 0 && (
                        <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                          Pages {selectedSegment.page_range[0] + 1}–
                          {selectedSegment.page_range[
                            selectedSegment.page_range.length - 1
                          ] + 1}
                        </span>
                      )}
                    </div>
                    {book?.gallica_url && (
                      <div
                        style={{
                          display: "flex",
                          border: "1px solid #e5e7eb",
                          borderRadius: 6,
                          overflow: "hidden",
                          flexShrink: 0,
                        }}
                      >
                        {(["text", "images"] as const).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => setViewMode(mode)}
                            style={{
                              padding: "0.2rem 0.65rem",
                              fontSize: "0.72rem",
                              fontWeight: 500,
                              border: "none",
                              cursor: "pointer",
                              background:
                                viewMode === mode ? "#1e40af" : "transparent",
                              color: viewMode === mode ? "#fff" : "#374151",
                            }}
                          >
                            {mode === "text" ? "OCR Text" : "Images"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      display:
                        viewMode === "images" && book?.gallica_url
                          ? "flex"
                          : "none",
                      flexDirection: "column",
                    }}
                  >
                    {/* Carousel nav */}
                    {selectedSegment.page_range.length > 0 && (
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
                          onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
                          disabled={pageIdx === 0}
                          style={{
                            padding: "0.15rem 0.5rem",
                            fontSize: "0.8rem",
                            border: "1px solid #e5e7eb",
                            borderRadius: 4,
                            background: pageIdx === 0 ? "#f9fafb" : "#fff",
                            color: pageIdx === 0 ? "#d1d5db" : "#374151",
                            cursor: pageIdx === 0 ? "default" : "pointer",
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
                          {selectedSegment.page_range[pageIdx] +
                            (book?.gallica_offset ?? 0)}{" "}
                          <span style={{ color: "#9ca3af" }}>
                            ({pageIdx + 1} / {selectedSegment.page_range.length}
                            )
                          </span>
                        </span>
                        <button
                          onClick={() =>
                            setPageIdx((i) =>
                              Math.min(
                                selectedSegment.page_range.length - 1,
                                i + 1,
                              ),
                            )
                          }
                          disabled={
                            pageIdx === selectedSegment.page_range.length - 1
                          }
                          style={{
                            padding: "0.15rem 0.5rem",
                            fontSize: "0.8rem",
                            border: "1px solid #e5e7eb",
                            borderRadius: 4,
                            background:
                              pageIdx === selectedSegment.page_range.length - 1
                                ? "#f9fafb"
                                : "#fff",
                            color:
                              pageIdx === selectedSegment.page_range.length - 1
                                ? "#d1d5db"
                                : "#374151",
                            cursor:
                              pageIdx === selectedSegment.page_range.length - 1
                                ? "default"
                                : "pointer",
                          }}
                        >
                          ▶
                        </button>
                      </div>
                    )}
                    {/* PanZoom viewport — key resets transform on page/segment change */}
                    <PanZoom key={`${selectedSegment.id}-${pageIdx}`}>
                      {selectedSegment.page_range.map((page, i) => {
                        const url = gallicaPageUrl(page);
                        return (
                          <div
                            key={page}
                            style={{
                              display: i === pageIdx ? "block" : "none",
                            }}
                          >
                            {url && (
                              <img
                                src={url}
                                alt={`Folio ${page + (book?.gallica_offset ?? 0)}`}
                                style={{
                                  width: "100%",
                                  display: "block",
                                  pointerEvents: "none",
                                }}
                                draggable={false}
                              />
                            )}
                          </div>
                        );
                      })}
                    </PanZoom>
                  </div>
                  <div
                    style={{
                      overflowY: "auto",
                      flex: 1,
                      padding: "1rem 1.25rem",
                      display:
                        viewMode === "text" || !book?.gallica_url
                          ? "block"
                          : "none",
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
      )}
    </div>
  );
}
