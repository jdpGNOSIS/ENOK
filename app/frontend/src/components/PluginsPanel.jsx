import React, { useState, useEffect } from "react";
import { Puzzle, Power, PowerOff, Trash2, RefreshCw, Download } from "lucide-react";

export default function PluginsPanel({ showAlert, showConfirm }) {
  const [plugins, setPlugins] = useState([]);
  const [installUrl, setInstallUrl] = useState("");

  const refresh = async () => {
    try {
      const res = await fetch("/api/plugins");
      const data = await res.json();
      setPlugins(data.plugins || []);
    } catch (_) {}
  };
  useEffect(() => { refresh(); }, []);

  const handleToggle = async (id, enabled) => {
    try {
      const res = await fetch(`/api/plugins/${id}/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
      const data = await res.json();
      if (data.ok) refresh();
    } catch (err) {
      showAlert?.({ title: "Toggle Failed", message: err.message, danger: true });
    }
  };

  const handleDelete = async (id) => {
    const ok = await showConfirm?.({ title: "Uninstall Plugin", message: "Remove this plugin?", confirmLabel: "Uninstall", danger: true });
    if (!ok) return;
    try {
      await fetch(`/api/plugins/${id}`, { method: "DELETE" });
      refresh();
    } catch (err) {
      showAlert?.({ title: "Uninstall Failed", message: err.message, danger: true });
    }
  };

  const handleInstall = async () => {
    if (!installUrl.trim()) return;
    try {
      const res = await fetch("/api/plugins/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: installUrl.trim() }) });
      const data = await res.json();
      if (data.ok) { setInstallUrl(""); refresh(); }
      else throw new Error(data.error || "Install failed");
    } catch (err) {
      showAlert?.({ title: "Install Failed", message: err.message, danger: true });
    }
  };

  return (
    <div className="workspace-area">
      <div className="workspace-title-section">
        <h2 className="workspace-title"><Puzzle size={20} /> Plugins</h2>
        <p className="workspace-subtitle">Extend the app with custom tools and panels.</p>
      </div>

      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <div className="m3-card" style={{ flex: "1 1 400px" }}>
          <h3 className="m3-card-title"><Puzzle size={16} /> Installed Plugins ({plugins.length})</h3>
          <button className="m3-btn m3-btn-outlined" onClick={refresh} style={{ marginBottom: "12px" }}><RefreshCw size={14} /> Refresh</button>
          {plugins.length === 0 ? (
            <p style={{ color: "var(--md-sys-color-outline)", fontSize: "0.85rem" }}>No plugins installed. Install one from URL or place .js files in app/plugins/</p>
          ) : (
            plugins.map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px", borderBottom: "1px solid var(--border-color)" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{p.name} <span style={{ fontWeight: 400, color: "var(--md-sys-color-outline)", fontSize: "0.78rem" }}>v{p.version}</span></div>
                  <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)" }}>{p.description || "No description"}</div>
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <button className="m3-btn m3-btn-tonal" style={{ height: "30px", padding: "0 8px", fontSize: "0.78rem" }} onClick={() => handleToggle(p.id, p.enabled)}>
                    {p.enabled ? <PowerOff size={12} /> : <Power size={12} />}
                    <span>{p.enabled ? "Disable" : "Enable"}</span>
                  </button>
                  <button className="m3-btn m3-btn-error" style={{ height: "30px", padding: "0 8px" }} onClick={() => handleDelete(p.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="m3-card" style={{ flex: "1 1 300px", alignSelf: "flex-start" }}>
          <h3 className="m3-card-title"><Download size={16} /> Install from URL</h3>
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <input className="m3-input" value={installUrl} onChange={e => setInstallUrl(e.target.value)} placeholder="https://example.com/plugin.js" style={{ flex: 1 }} onKeyDown={e => e.key === "Enter" && handleInstall()} />
            <button className="m3-btn m3-btn-filled" onClick={handleInstall} disabled={!installUrl.trim()}><Download size={14} /></button>
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", marginTop: "8px" }}>
            Or copy .js/.mjs plugin files directly into the <code>app/plugins/</code> folder.
          </p>
        </div>
      </div>
    </div>
  );
}
