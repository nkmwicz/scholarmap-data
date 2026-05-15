import { useState } from "react";
import {
  api,
  type Segment,
  type LetterSummary,
  type ChapterSummary,
} from "../api/client";

interface Props {
  segment: Segment;
  bookId: string;
  onUpdate: (updated: Segment) => void;
  gallicaUrl?: string | null;
  gallicaOffset?: number | null;
}

function SectionList({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: "0.9rem" }}>
      <div
        style={{
          fontSize: "0.7rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "#9ca3af",
          marginBottom: "0.3rem",
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
        {items.map((item, i) => (
          <span
            key={i}
            style={{
              fontSize: "0.75rem",
              padding: "0.15rem 0.55rem",
              borderRadius: 9999,
              background: "#f3f4f6",
              color: "#374151",
              border: "1px solid #e5e7eb",
            }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SegmentSummaryPanel({
  segment,
  bookId,
  onUpdate,
  gallicaUrl,
  gallicaOffset,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isLetter = segment.document_type === "letters";
  const summary = segment.ai_summary as (LetterSummary & ChapterSummary) | null;

  const handleGenerate = async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const updated = await api.segments.summarize(bookId, segment.id, force);
      onUpdate(updated);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem" }}>
      {/* No summary yet */}
      {!summary && !loading && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            paddingTop: "2rem",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "0.82rem",
              color: "#9ca3af",
              textAlign: "center",
            }}
          >
            No summary generated yet.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => handleGenerate(false)}
            style={{ fontSize: "0.82rem" }}
          >
            Generate Summary
          </button>
          {error && (
            <p style={{ fontSize: "0.75rem", color: "#dc2626", margin: 0 }}>
              {error}
            </p>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.5rem",
            paddingTop: "2rem",
            color: "#9ca3af",
            fontSize: "0.82rem",
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              border: "2px solid #e5e7eb",
              borderTopColor: "#7c3aed",
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }}
          />
          Generating summary…
        </div>
      )}

      {/* Summary */}
      {summary && !loading && (
        <>
          {/* Letter-specific fields */}
          {isLetter && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.6rem 1.2rem",
                marginBottom: "1rem",
              }}
            >
              {[
                ["Author", (summary as LetterSummary).author],
                ["Author Location", (summary as LetterSummary).author_location],
                ["Recipient", (summary as LetterSummary).recipient],
                [
                  "Recipient Location",
                  (summary as LetterSummary).recipient_location,
                ],
                ["Date", (summary as LetterSummary).date],
              ]
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label}>
                    <div
                      style={{
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "#9ca3af",
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: "#111827",
                        marginTop: 2,
                      }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Summary text */}
          {summary.summary && (
            <div style={{ marginBottom: "0.9rem" }}>
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "#9ca3af",
                  marginBottom: "0.3rem",
                }}
              >
                Summary
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.82rem",
                  color: "#1f2937",
                  lineHeight: 1.65,
                }}
              >
                {summary.summary}
              </p>
            </div>
          )}

          <SectionList
            title="People Referenced"
            items={summary.people_referenced}
          />
          <SectionList
            title="Places Referenced"
            items={summary.places_referenced}
          />
          <SectionList
            title="Events Referenced"
            items={summary.events_referenced}
          />

          {/* Gallica source image links */}
          {gallicaUrl &&
            gallicaOffset != null &&
            segment.page_range.length > 0 && (
              <div style={{ marginBottom: "0.9rem" }}>
                <div
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "#9ca3af",
                    marginBottom: "0.4rem",
                  }}
                >
                  Source Images
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  {segment.page_range.map((page) => (
                    <span
                      key={page}
                      style={{
                        fontSize: "0.72rem",
                        color: "#374151",
                        fontFamily: "monospace",
                        wordBreak: "break-all",
                        userSelect: "all",
                      }}
                    >
                      {`${gallicaUrl}/f${page + gallicaOffset}.highres`}
                    </span>
                  ))}
                </div>
              </div>
            )}

          <div style={{ marginTop: "0.5rem" }}>
            <button
              onClick={() => handleGenerate(true)}
              style={{
                fontSize: "0.72rem",
                color: "#6b7280",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline",
              }}
            >
              Regenerate
            </button>
            {error && (
              <span
                style={{
                  fontSize: "0.72rem",
                  color: "#dc2626",
                  marginLeft: "0.75rem",
                }}
              >
                {error}
              </span>
            )}
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
