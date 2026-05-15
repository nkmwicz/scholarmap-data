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

export interface BoundariesPayload {
  boundaries: BoundaryItem[];
  excluded_pages: number[];
}

export interface ClusterLabel {
  parent_index: number; // 0-based
  sub_index: number | null; // 0-based position within parent; null if top-level
}

export interface Segment {
  id: string;
  segment_index: number;
  title: string;
  markdown: string;
  page_range: number[];
  document_type: DocumentType;
  cluster_labels?: ClusterLabel[];
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
  },

  embed: {
    trigger: (bookId: string) =>
      request<{ status: string }>(`/books/${bookId}/embed`, { method: "POST" }),
    stats: (bookId: string) =>
      request<{ segment_count: number; chunk_count: number }>(
        `/books/${bookId}/embed/stats`,
      ),
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
  },
};
