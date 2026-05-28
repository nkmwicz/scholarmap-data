import { useState } from "react";
import { api, type Segment } from "../api/client";

interface Props {
  segment: Segment;
  bookId: string;
  onUpdate: (updated: Segment) => void;
}

export function UnimportantToggleButton({ segment, bookId, onUpdate }: Props) {
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    try {
      const updated = await api.segments.patch(bookId, segment.id, {
        unimportant: !segment.unimportant,
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
        segment.unimportant
          ? "Click to mark as important"
          : "Click to mark as unimportant"
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.2rem 0.6rem",
        fontSize: "0.72rem",
        fontWeight: segment.unimportant ? 600 : 400,
        border: `1px solid ${segment.unimportant ? "#dc2626" : "#e5e7eb"}`,
        borderRadius: 6,
        background: segment.unimportant ? "#fef2f2" : "#fff",
        color: segment.unimportant ? "#dc2626" : "#9ca3af",
        cursor: toggling ? "wait" : "pointer",
        flexShrink: 0,
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {segment.unimportant ? "✗" : "◯"} Unimp.
    </button>
  );
}
