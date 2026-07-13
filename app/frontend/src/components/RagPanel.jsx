import React, { useState, useRef, useCallback } from "react";
import { BookOpen, Upload, Search, FileText, Trash2, LoaderCircle, X } from "lucide-react";

export default function RagPanel({ showAlert, showConfirm }) {
  const [documents, setDocuments] = useState([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileUpload = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setIsIngesting(true);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/rag/ingest", { method: "POST", body: formData });
        const data = await res.json();
        if (data.ok) {
          setDocuments(prev => [...prev, { id: data.id, name: file.name, pages: data.pages || 1, chunks: data.chunks || 0 }]);
        }
      }
    } catch (err) {
      showAlert?.({ title: "Ingest Failed", message: err.message, danger: true });
    } finally {
      setIsIngesting(false);
      e.target.value = "";
    }
  }, [showAlert]);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setSearchResults(null);
    try {
      const res = await fetch("/api/rag/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), top_k: 5 }),
      });
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      showAlert?.({ title: "Search Failed", message: err.message, danger: true });
    } finally {
      setIsSearching(false);
    }
  }, [query, showAlert]);

  const handleDelete = useCallback(async (id) => {
    const ok = await showConfirm?.({ title: "Delete Document", message: "Remove this document from the index?", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await fetch(`/api/rag/documents/${id}`, { method: "DELETE" });
      setDocuments(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      showAlert?.({ title: "Delete Failed", message: err.message, danger: true });
    }
  }, [showConfirm, showAlert]);

  return (
    <div className="workspace-area">
      <div className="workspace-title-section">
        <h2 className="workspace-title"><BookOpen size={20} /> RAG Engine</h2>
        <p className="workspace-subtitle">Upload documents and search them with AI context.</p>
      </div>

      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <div className="m3-card" style={{ flex: "1 1 350px" }}>
          <h3 className="m3-card-title"><Upload size={16} /> Upload Documents</h3>
          <input type="file" ref={fileInputRef} multiple accept=".pdf,.txt,.md,.csv,.docx" onChange={handleFileUpload} style={{ display: "none" }} />
          <button className="m3-btn m3-btn-filled" onClick={() => fileInputRef.current?.click()} disabled={isIngesting} style={{ width: "100%", marginTop: "12px" }}>
            {isIngesting ? <LoaderCircle className="progress-spinner" size={16} /> : <Upload size={16} />}
            <span>{isIngesting ? "Ingesting..." : "Upload Documents"}</span>
          </button>
          {documents.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <h4 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "8px" }}>Indexed Documents ({documents.length})</h4>
              {documents.map(doc => (
                <div key={doc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", borderBottom: "1px solid var(--border-color)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
                    <FileText size={14} />
                    <span style={{ fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</span>
                    <span style={{ fontSize: "0.72rem", color: "var(--md-sys-color-outline)" }}>{doc.chunks} chunks</span>
                  </div>
                  <button onClick={() => handleDelete(doc.id)} style={{ background: "none", border: "none", color: "var(--md-sys-color-error)", cursor: "pointer", padding: "4px" }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="m3-card" style={{ flex: "1 1 350px" }}>
          <h3 className="m3-card-title"><Search size={16} /> Search Documents</h3>
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <input className="m3-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your documents..." onKeyDown={e => e.key === "Enter" && handleSearch()} style={{ flex: 1 }} />
            <button className="m3-btn m3-btn-filled" onClick={handleSearch} disabled={!query.trim() || isSearching}>
              {isSearching ? <LoaderCircle className="progress-spinner" size={14} /> : <Search size={14} />}
            </button>
          </div>

          {searchResults && (
            <div style={{ marginTop: "16px" }}>
              <h4 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "8px" }}>Results</h4>
              {searchResults.length === 0 ? (
                <p style={{ color: "var(--md-sys-color-outline)", fontSize: "0.85rem" }}>No results found.</p>
              ) : (
                searchResults.map((r, i) => (
                  <div key={i} style={{ padding: "10px", marginBottom: "8px", background: "var(--md-sys-color-surface-variant)", borderRadius: "8px", fontSize: "0.85rem" }}>
                    <div style={{ fontWeight: 600, marginBottom: "4px" }}>{r.source || "Document"}</div>
                    <p style={{ margin: 0, lineHeight: 1.5 }}>{r.content}</p>
                    {r.score && <div style={{ fontSize: "0.72rem", color: "var(--md-sys-color-outline)", marginTop: "4px" }}>Score: {(r.score * 100).toFixed(0)}%</div>}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="m3-card" style={{ marginTop: "16px" }}>
        <h3 className="m3-card-title"><BookOpen size={16} /> About RAG</h3>
        <p style={{ fontSize: "0.85rem", lineHeight: 1.6, color: "var(--md-sys-color-on-surface-variant)" }}>
          Upload PDFs, text files, or documents. The system indexes them using hybrid search (BM25 + vector embeddings) so the AI can answer questions about your content.
        </p>
      </div>
    </div>
  );
}
