import { useState } from "react";
import { api, type Segment } from "../api/client";

interface Props {
  segment: Segment;
  bookId: string;
  onUpdate: (updated: Segment) => void;
}

export function Neo4jToggleButton({ segment, bookId, onUpdate }: Props) {
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    try {
      const updated = await api.segments.patch(bookId, segment.id, {
        neo4j_entered: !segment.neo4j_entered,
      });
      onUpdate(updated);
    } catch {
      // silently ignore
    } finally {
      setToggling(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={toggling}
      title={
        segment.neo4j_entered
          ? "Click to mark as not yet in Neo4j"
          : "Click to mark as entered in Neo4j"
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.2rem 0.6rem",
        fontSize: "0.72rem",
        fontWeight: segment.neo4j_entered ? 600 : 400,
        border: `1px solid ${segment.neo4j_entered ? "#059669" : "#e5e7eb"}`,
        borderRadius: 6,
        background: segment.neo4j_entered ? "#ecfdf5" : "#fff",
        color: segment.neo4j_entered ? "#059669" : "#9ca3af",
        cursor: toggling ? "wait" : "pointer",
        flexShrink: 0,
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {segment.neo4j_entered ? "✔️" : "◯"} Neo4j
    </button>
  );
}
