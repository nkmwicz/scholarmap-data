import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Book, type DocumentType } from "../api/client";
import StatusBadge from "../components/StatusBadge";

export default function BookList() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    slug: "",
    title: "",
    document_type: "letters" as DocumentType,
  });
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    api.books
      .list()
      .then(setBooks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const book = await api.books.create(form);
      navigate(`/books/${book.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h1 style={{ margin: 0 }}>Books</h1>
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Cancel" : "+ New Book"}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: "1.5rem", maxWidth: 480 }}>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>Slug (unique ID)</label>
              <input
                required
                placeholder="ribier_v1"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Title</label>
              <input
                required
                placeholder="Lettres de Ribier"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Document Type</label>
              <select
                value={form.document_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    document_type: e.target.value as DocumentType,
                  })
                }
              >
                <option value="letters">Letters</option>
                <option value="chapters">Chapters</option>
                <option value="other">Other</option>
              </select>
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary" disabled={creating}>
              {creating ? "Creating…" : "Create Book"}
            </button>
          </form>
        </div>
      )}

      {loading && <p>Loading…</p>}
      {!loading && books.length === 0 && (
        <p>No books yet. Create one to get started.</p>
      )}

      <div style={{ display: "grid", gap: "0.75rem" }}>
        {books.map((book) => (
          <Link
            key={book.id}
            to={`/books/${book.id}`}
            style={{ textDecoration: "none" }}
          >
            <div
              className="card"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong>{book.title}</strong>
                <span
                  style={{
                    color: "#6b7280",
                    fontSize: "0.8rem",
                    marginLeft: "0.5rem",
                  }}
                >
                  {book.slug}
                </span>
                <span
                  style={{
                    color: "#9ca3af",
                    fontSize: "0.75rem",
                    marginLeft: "0.75rem",
                  }}
                >
                  {book.document_type}
                </span>
              </div>
              <StatusBadge status={book.status} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
