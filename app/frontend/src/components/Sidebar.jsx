import React, { memo } from "react";
import { Image, FolderDown, MessageSquare, Mic, Settings, Shield, Terminal, ChevronDown, ChevronUp, Trash2, Volume2, Globe2, BookOpen, BrainCircuit, Puzzle } from "lucide-react";

function formatSidebarDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dateStr = date.toLocaleDateString();
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${dateStr} ${timeStr}`;
}

function Sidebar({ 
  collapsed = false,
  activeTab, 
  setActiveTab, 
  specs,
}) {
  const navItems = [
    { id: "generator", icon: Image, label: "Image Generator" },
    { id: "chat", icon: MessageSquare, label: "Text Chat" },
    { id: "modelhub", icon: Globe2, label: "Model Hub" },
    { id: "rag", icon: BookOpen, label: "AI RAG" },
    { id: "agent", icon: BrainCircuit, label: "Agent Mode" },
    { id: "speech", icon: Mic, label: "Speech" },
    { id: "tts", icon: Volume2, label: "TTS" },
    { id: "models", icon: FolderDown, label: "Manager" },
    { id: "plugins", icon: Puzzle, label: "Plugins" },
    { id: "settings", icon: Settings, label: "Settings" },
  ];

  return (
    <div className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div>
        <div className="sidebar-logo">
          <Shield className="sidebar-logo-icon" />
          <span className="sidebar-logo-text">Local AI Studio</span>
        </div>

        <div className="nav-list">
          {navItems.map(({ id, icon: Icon, label }) => (
            <div
              key={id}
              className={`nav-item ${activeTab === id ? "active" : ""}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={20} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-specs-header">
          <Terminal size={12} />
          <span>Host Specifications</span>
        </div>
        <div className="sidebar-specs-item" title={specs.cpu_name}>
          CPU: {specs.cpu_name}
        </div>
        <div className="sidebar-specs-item" title={specs.gpu_name}>
          GPU: {specs.gpu_name}
        </div>
        <div className="sidebar-specs-item">
          Memory: {specs.ram_total_gb.toFixed(0)} GB RAM ({specs.cpu_cores_physical} Cores)
        </div>
        <div className="sidebar-specs-os">
          OS: {specs.os_name}
        </div>
      </div>
    </div>
  );
}

export default memo(Sidebar);
