import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import BookList from "./pages/BookList";
import BookDetail from "./pages/BookDetail";
import SegmentBoundaryEditor from "./pages/SegmentBoundaryEditor";
import ClusterView from "./pages/ClusterView";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <nav className="nav">
        <NavLink to="/" end className="nav-brand">
          Scholarmap
        </NavLink>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<BookList />} />
          <Route path="/books/:bookId" element={<BookDetail />} />
          <Route
            path="/books/:bookId/boundaries"
            element={<SegmentBoundaryEditor />}
          />
          <Route path="/books/:bookId/clusters" element={<ClusterView />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

export default App;
