import type { Book } from "../api/client";

const STATUS_CLASS: Record<string, string> = {
  pending: "badge-pending",
  ocr_processing: "badge-ocr",
  ocr_complete: "badge-ocr_complete",
  boundaries_pending: "badge-segments",
  segments_complete: "badge-segments",
  embedding: "badge-embedded",
  embedded: "badge-embedded",
  clustering: "badge-ocr",
  clustered: "badge-labeled",
  labeled: "badge-labeled",
  error: "badge-error",
};

export default function StatusBadge({ status }: { status: Book["status"] }) {
  const cls = STATUS_CLASS[status] ?? "badge-pending";
  return <span className={`badge ${cls}`}>{status.replace(/_/g, " ")}</span>;
}
