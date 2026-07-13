import React, { useState, useEffect, useRef } from "react";
import { BrainCircuit, Send, Terminal, Square, Globe2, Trash2 } from "lucide-react";

export default function AgentPanel({ showAlert }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [isBusy, setIsBusy] = useState(false);
  const [tools, setTools] = useState([]);
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful AI assistant with access to tools.");
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch("/api/agent/tools").then(r => r.json()).then(d => setTools(d.tools || [])).catch(() => {});
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isBusy) return;
    const userMsg = { role: "user", content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsBusy(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMsg], systemPrompt }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.content, toolCalls: data.toolCalls, webSources: data.webSources }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}`, error: true }]);
    } finally {
      setIsBusy(false);
    }
  };

  const handleClear = () => { setMessages([]); };

  return (
    <div className="workspace-area" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="workspace-title-section">
        <h2 className="workspace-title"><BrainCircuit size={20} /> Agent Mode</h2>
        <p className="workspace-subtitle">AI agent with tool access — web search, code execution, file ops.</p>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        {tools.map(t => (
          <div key={t.name} className="status-chip" title={t.description}>
            <Terminal size={12} />
            <span>{t.name}</span>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", marginBottom: "12px", padding: "12px", background: "var(--md-sys-color-surface-variant)", borderRadius: "12px" }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--md-sys-color-outline)" }}>
            <BrainCircuit size={40} style={{ opacity: 0.4, marginBottom: "12px" }} />
            <p>Send a message. The agent can use tools to answer questions, browse the web, or execute code.</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`chat-message-row ${msg.role}`}>
              <div className={`chat-avatar ${msg.role}`}>{msg.role === "user" ? "You" : "AI"}</div>
              <div className="chat-bubble-wrap">
                <span className="chat-sender-label">{msg.role === "user" ? "You" : "Agent"}</span>
                {Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0 && (
                  <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-primary)", marginBottom: "6px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {msg.toolCalls.map((tc, j) => (
                      <span key={j} className="status-chip" style={{ fontSize: "0.72rem" }}>
                        <Terminal size={10} /> {tc.tool}: {tc.status || "called"}
                      </span>
                    ))}
                  </div>
                )}
                <div className={`chat-bubble ${msg.error ? "error" : ""}`}>{msg.content}</div>
                {Array.isArray(msg.webSources) && msg.webSources.length > 0 && (
                  <div style={{ marginTop: "8px", padding: "8px", border: "1px solid var(--border-color)", borderRadius: "8px", fontSize: "0.8rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, marginBottom: "4px" }}>
                      <Globe2 size={12} /> Sources
                    </div>
                    {msg.webSources.map((s, j) => (
                      <a key={j} href={s.url} target="_blank" rel="noreferrer" style={{ display: "block", color: "var(--md-sys-color-primary)", fontSize: "0.78rem" }}>{s.title || s.url}</a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-composer">
        <div className="chat-composer-inner">
          <div className="chat-composer-textarea-container">
            <textarea className="chat-composer-textarea" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="Ask the agent anything..." disabled={isBusy} rows={1} />
          </div>
          <div className="chat-composer-toolbar">
            <div className="chat-composer-toolbar-right">
              <button className="m3-btn m3-btn-outlined" onClick={handleClear} disabled={messages.length === 0} style={{ height: "32px", padding: "0 10px" }}>
                <Trash2 size={14} />
              </button>
              {isBusy ? (
                <button className="chat-composer-stop-btn" onClick={() => fetch("/api/agent/reset", { method: "POST" }).catch(() => {})}>
                  <Square size={15} fill="currentColor" />
                </button>
              ) : (
                <button className="chat-composer-send-btn" onClick={handleSend} disabled={!input.trim()}>
                  <Send size={17} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
