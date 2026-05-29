// Typed API client — all requests go through Vite's /api proxy

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocumentType = "letters" | "chapters" | "other";

export interface Book {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  year: string | null;
  volume_number: number | null;
  description: string | null;
  document_type: DocumentType;
  status: string;
  gallica_url: string | null;
  gallica_offset: number | null;
}

export interface OcrPage {
  page_index: number;
  markdown: string;
  lines: string[];
}

export interface BoundaryItem {
  boundary_index: number;
  page_index: number;
  line_index: number;
  segment_title: string;
}

export interface ExcludedLineItem {
  page_index: number;
  line_index: number;
}

export interface BoundariesPayload {
  boundaries: BoundaryItem[];
  excluded_pages: number[];
  excluded_lines: ExcludedLineItem[];
}

export interface ClusterLabel {
  parent_index: number; // 0-based
  sub_index: number | null; // 0-based position within parent; null if top-level
}

export interface SearchResult {
  chunk_id: string;
  chunk_text: string;
  score: number;
  segment_id: string;
  segment_index: number;
  segment_title: string;
  page_range: number[];
  book_id: string;
  book_title: string;
  book_author: string | null;
  book_year: string | null;
  cluster_labels: ClusterLabel[];
}

export interface LetterSummary {
  /** V1 — flat structure, no version field */
  author: string;
  author_location: string;
  recipient: string;
  recipient_location: string;
  date: string;
  summary: string;
  people_referenced: string[];
  places_referenced: string[];
  events_referenced: string[];
}

export interface NoteExtract {
  summary: string;
  people_referenced: string[];
  places_referenced: string[];
  events_referenced: string[];
}

export interface LetterSummaryV2 {
  /** V2 — hierarchical with per-matter notes */
  version: 2;
  author: string;
  author_location: string;
  recipient: string;
  recipient_location: string;
  date: string;
  summary: string;
  notes: NoteExtract[];
}

export interface ChapterSummary {
  summary: string;
  people_referenced: string[];
  places_referenced: string[];
  events_referenced: string[];
}

export interface ClusterChunk {
  chunk_id: string;
  chunk_index: number;
  text: string;
  segment_id: string;
  segment_index: number;
  segment_title: string;
  page_range: number[];
  ai_summary: ChapterSummary | null;
  neo4j_entered: boolean;
  unimportant: boolean;
}

export interface Segment {
  id: string;
  segment_index: number;
  title: string;
  markdown: string;
  page_range: number[];
  page_char_offsets?: Record<string, number> | null;
  document_type: DocumentType;
  cluster_labels?: ClusterLabel[];
  ai_summary: LetterSummary | LetterSummaryV2 | ChapterSummary | null;
  neo4j_entered: boolean;
  unimportant: boolean;
}

export interface SegmentChunkWithLabels {
  chunk_id: string;
  chunk_index: number;
  text: string;
  page_range: number[];
  cluster_labels: ClusterLabel[];
  neo4j_entered: boolean;
  unimportant: boolean;
}

export interface RepresentativeSample {
  chunk_id: string;
  text: string;
  segment_title: string;
}

export interface Cluster {
  id: string;
  cluster_index: number;
  tags: string[];
  is_subcluster: boolean;
  parent_cluster_id: string | null;
  representative_samples: RepresentativeSample[];
  total_count: number;
  unimportant_count: number;
  neo4j_count: number;
}

export interface SubclusterInfo {
  parent_index: number;
  child_count: number;
}

export interface ClusterStats {
  parent_count: number;
  subclusters: SubclusterInfo[];
}

// ── Books ─────────────────────────────────────────────────────────────────────

export const api = {
  books: {
    list: () => request<Book[]>("/books"),
    get: (id: string) => request<Book>(`/books/${id}`),
    setGallica: (id: string, gallica_url: string, gallica_offset: number) =>
      request<Book>(`/books/${id}/gallica`, {
        method: "PATCH",
        body: JSON.stringify({ gallica_url, gallica_offset }),
      }),
    create: (payload: {
      slug: string;
      title: string;
      author?: string;
      year?: string;
      volume_number?: number;
      description?: string;
      document_type: DocumentType;
    }) =>
      request<Book>("/books", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    uploadPdf: (id: string, file: File) => {
      const form = new FormData();
      form.append("pdf", file);
      return request<{ status: string }>(`/books/${id}/ocr`, {
        method: "POST",
        headers: {},
        body: form,
      });
    },
    pages: (id: string) => request<OcrPage[]>(`/books/${id}/pages`),
    ocrProgress: (id: string) =>
      request<{ message: string | null }>(`/books/${id}/ocr/progress`),
    downloadMarkdown: async (id: string, slug: string) => {
      const res = await fetch(`${BASE}/books/${id}/ocr/markdown`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${res.statusText}: ${text}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.md`;
      a.click();
      URL.revokeObjectURL(url);
    },
  },

  boundaries: {
    get: (bookId: string) =>
      request<BoundariesPayload>(`/books/${bookId}/boundaries`),
    save: (bookId: string, payload: BoundariesPayload) =>
      request<void>(`/books/${bookId}/boundaries`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    confirm: (bookId: string) =>
      request<{ status: string }>(`/books/${bookId}/segments/confirm`, {
        method: "POST",
      }),
  },

  segments: {
    list: (bookId: string) => request<Segment[]>(`/books/${bookId}/segments`),
    get: (bookId: string, segmentId: string) =>
      request<Segment>(`/books/${bookId}/segments/${segmentId}`),
    summarize: (bookId: string, segmentId: string, force = false) =>
      request<Segment>(
        `/books/${bookId}/segments/${segmentId}/summary?force=${force}`,
        {
          method: "POST",
        },
      ),
    patch: (
      bookId: string,
      segmentId: string,
      data: { neo4j_entered?: boolean; unimportant?: boolean },
    ) =>
      request<Segment>(`/books/${bookId}/segments/${segmentId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    chunks: (bookId: string, segmentId: string) =>
      request<SegmentChunkWithLabels[]>(
        `/books/${bookId}/segments/${segmentId}/chunks`,
      ),
    backfillOffsets: (bookId: string) =>
      request<{ updated: number }>(
        `/books/${bookId}/segments/backfill-offsets`,
        {
          method: "POST",
        },
      ),
  },

  embed: {
    trigger: (bookId: string) =>
      request<{ status: string }>(`/books/${bookId}/embed`, { method: "POST" }),
    stats: (bookId: string) =>
      request<{ segment_count: number; chunk_count: number }>(
        `/books/${bookId}/embed/stats`,
      ),
  },

  search: {
    query: (q: string, limit = 20) =>
      request<SearchResult[]>("/search", {
        method: "POST",
        body: JSON.stringify({ query: q, limit }),
      }),
    similar: (chunkId: string, limit = 20) =>
      request<SearchResult[]>(`/search/similar/${chunkId}?limit=${limit}`),
  },

  clusters: {
    trigger: (bookId: string) =>
      request<{ status: string }>(`/books/${bookId}/cluster`, {
        method: "POST",
      }),
    stats: (bookId: string) =>
      request<ClusterStats>(`/books/${bookId}/clusters/stats`),
    list: (bookId: string) => request<Cluster[]>(`/books/${bookId}/clusters`),
    segments: (bookId: string, clusterId: string) =>
      request<Segment[]>(`/books/${bookId}/clusters/${clusterId}/segments`),
    chunks: (bookId: string, clusterId: string) =>
      request<ClusterChunk[]>(`/books/${bookId}/clusters/${clusterId}/chunks`),
  },

  chunks: {
    summarize: (bookId: string, chunkId: string, force = false) =>
      request<{ chunk_id: string; ai_summary: ChapterSummary | null }>(
        `/books/${bookId}/chunks/${chunkId}/summary?force=${force}`,
        { method: "POST" },
      ),
    patch: (
      bookId: string,
      chunkId: string,
      data: { neo4j_entered?: boolean; unimportant?: boolean },
    ) =>
      request<{
        chunk_id: string;
        neo4j_entered: boolean;
        unimportant: boolean;
      }>(`/books/${bookId}/chunks/${chunkId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
  },
};
