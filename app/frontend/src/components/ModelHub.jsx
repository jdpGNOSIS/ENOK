import React, { memo, useState, useEffect, useRef } from "react";
import {
  Search, X, DownloadCloud, TrendingUp, Star,
  Cpu, HardDrive, Eye,
  Info, FileText, Layers, BrainCircuit,
  RefreshCw, AlertTriangle, Cloud, Volume2, Image
} from "lucide-react";
import {
  searchHuggingFaceModels,
  downloadLlmModel,
  downloadModel,
  getDownloadProgress,
  cancelModelDownload
} from "../services/api";
import "./ModelHub.css";

const TRENDING_MODELS = [
  {
    id: "mistral-7b",
    name: "Mistral 7B Instruct",
    filename: "mistral-7b-instruct-v0.3-q4_k_m.gguf",
    url: "https://huggingface.co/MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3.Q4_K_M.gguf",
    size: "4.1 GB",
    downloads: "12M+",
    pipeline: "text-generation",
    description: "High-performance 7B parameter model with strong reasoning and instruction following.",
  },
  {
    id: "llama-3-8b",
    name: "Llama 3.1 8B Instruct",
    filename: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    url: "https://huggingface.co/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    size: "4.9 GB",
    downloads: "8.5M+",
    pipeline: "text-generation",
    tags: ["text"],
    notes: "Meta's latest 8B model with improved reasoning, multilingual support, and 128K context.",
  },
  {
    id: "qwen-2.5-7b",
    name: "Qwen 2.5 Coder 7B Instruct",
    filename: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    size: "4.7 GB",
    downloads: "1.2M+",
    pipeline: "text-generation",
    tags: ["text", "vision"],
    notes: "Excellent coding assistant with state-of-the-art code generation and reasoning.",
  },
  {
    id: "nous-hermes-2",
    name: "Nous Hermes 2 Mixtral",
    filename: "Nous-Hermes-2-Mixtral-8x7B-DPO-Q4_K_M.gguf",
    url: "https://huggingface.co/NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO-GGUF/resolve/main/Nous-Hermes-2-Mixtral-8x7B-DPO.Q4_K_M.gguf",
    size: "24.2 GB",
    downloads: "800K+",
    pipeline: "text-generation",
    tags: ["text"],
    notes: "High-quality instruction-tuned model based on Mixtral 8x7B MoE architecture.",
  },
  {
    id: "smollm2-1.7b",
    name: "SmolLM2 1.7B Instruct",
    filename: "smollm2-1.7b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/main/smollm2-1.7b-instruct-q4_k_m.gguf",
    size: "1.1 GB",
    downloads: "500K+",
    pipeline: "text-generation",
    tags: ["text"],
    notes: "Lightweight but capable 1.7B model excellent for low-resource systems.",
  },
  {
    id: "dolphin-2.9",
    name: "Dolphin 2.9 Llama 3 8B",
    filename: "dolphin-2.9-llama3-8b-Q4_K_M.gguf",
    url: "https://huggingface.co/cognitivecomputations/dolphin-2.9-llama3-8b-gguf/resolve/main/dolphin-2.9-llama3-8b-Q4_K_M.gguf",
    size: "4.9 GB",
    downloads: "2M+",
    pipeline: "text-generation",
    tags: ["text", "uncensored"],
    notes: "Uncensored model with excellent creative writing and roleplay capabilities.",
  },
];

const CATEGORY_FILTERS = [
  { id: "text", label: "Text", icon: FileText },
  { id: "image", label: "Image", icon: Image },
  { id: "speech", label: "Speech", icon: Volume2 },
  { id: "vision", label: "Vision", icon: Eye },
  { id: "embedding", label: "Embedding", icon: Layers },
];

function formatNumber(num) {
  if (!num) return "Unknown";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return String(num);
}

function estimateVRAM(sizeStr) {
  const known = {
    "1.1 GB": "2-4 GB",
    "2.1 GB": "4-6 GB",
    "4.1 GB": "6-8 GB",
    "4.7 GB": "6-8 GB",
    "4.9 GB": "6-8 GB",
    "6.6 GB": "8-12 GB",
    "24.2 GB": "16-24 GB",
  };
  return known[sizeStr] || "4-8 GB";
}

function ModelHub({
  showAlert = async ({ message }) => window.alert(message),
  showConfirm = async ({ message }) => window.confirm(message),
  activeModel,
  setActiveModel,
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState([]);
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState("");
  const [selectedModel, setSelectedModel] = useState(null);
  const searchRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, query ? 400 : 0);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery && selectedFilters.length === 0) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    const requestId = ++searchRef.current;
    const doSearch = async () => {
      setIsSearching(true);
      setSearchError("");
      try {
        const result = await searchHuggingFaceModels(debouncedQuery, selectedFilters, 1);
        if (requestId !== searchRequest.current) return;
        setResults(result.models || []);
        setHasSearched(true);
        setPage(1);
        setHasMore(result.hasMore);
      } catch (err) {
        if (requestId !== searchRequest.current) return;
        setResults([]);
        setSearchError(err.message || "Search failed");
        setHasMore(false);
      } finally {
        if (requestId === searchRequest.current) setIsSearching(false);
      }
    };
    doSearch();
  }, [debouncedQuery, selectedFilters]);

  const toggleFilter = (filterId) => {
    setSelectedFilters((prev) =>
      prev.includes(filterId)
        ? prev.filter((f) => f !== filterId)
        : [...prev, filterId]
    );
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const result = await searchHuggingFaceModels(debouncedQuery, selectedFilters, nextPage);
      setResults((prev) => {
        const known = new Set(prev.map((m) => m.id));
        return [...prev, ...(result.models || []).filter((m) => !known.has(m.id))];
      });
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch (err) {
      setSearchError(err.message || "Could not load more");
    } finally {
      setLoadingMore(false);
    }
  };

  const startProgressPolling = (modelId) => {
    setDownloadingModelId(modelId);
    const interval = setInterval(async () => {
      try {
        const status = await getDownloadProgress();
        if (status.active) {
          setDownloadProgress(status.progress === -1 ? 0 : status.progress);
          setDownloadSpeed(`${status.speed} • ETA ${status.eta}s`);
        } else {
          clearInterval(interval);
          setDownloadingModelId(null);
          setDownloadProgress(0);
          setDownloadSpeed("");
          if (status.error && !String(status.error).toLowerCase().includes("cancelled")) {
            showAlert({ title: "Download Failed", message: status.error, danger: true });
          }
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 1000);
  };

  const handleDownload = async (model) => {
    if (downloadingModelId) return;
    const url = model.url || model.downloadUrl;
    const filename = model.filename || model.name;
    if (!url) {
      showAlert({ title: "No URL", message: "This model has no download URL available.", danger: true });
      return;
    }
    const confirmed = await showConfirm({
      title: "Download Model?",
      message: `Download "${model.name}"${model.size ? ` (${model.size})` : ""}?`,
      confirmLabel: "Download",
    });
    if (!confirmed) return;
    try {
      const isTextModel = model.pipeline === "text-generation" || model.pipeline === "text" || !model.pipeline;
      let res;
      if (isTextModel) {
        res = await downloadLlmModel(url, filename);
      } else {
        res = await downloadModel(url);
      }
      if (res && res.ok) {
        startProgressPolling(filename || model.name);
      } else {
        showAlert({ title: "Download Failed", message: res?.error || "Unknown error", danger: true });
      }
    } catch (err) {
      showAlert({ title: "Download Error", message: err.message, danger: true });
    }
  };

  const handleCancelDownload = async () => {
    try {
      await cancelModelDownload();
      setDownloadingModelId(null);
      setDownloadProgress(0);
      setDownloadSpeed("");
    } catch (err) {
      console.error(err);
    }
  };

  const openModal = (model) => setSelectedModel(model);
  const closeModal = () => setSelectedModel(null);

  const renderModelCard = (model, isTrending = false) => {
    const isDownloading = downloadingModelId === (model.filename || model.name);
    const pipeTag = model.pipeline || model.tags?.[0] || "model";
    return (
      <div
        key={model.id || model.name}
        className={`m3-card hub-card ${isTrending ? "hub-trending-card" : ""}`}
        onClick={() => openModal(model)}
      >
        <div className="hub-card-header">
          <div className="hub-card-name">{model.name}</div>
          <span className="hub-pipeline-tag">{pipeTag}</span>
        </div>
        {model.notes && <div className="hub-card-notes">{model.notes}</div>}
        <div className="hub-card-meta">
          {model.downloads && (
            <div className="hub-meta-item">
              <DownloadCloud size={13} />
              <span>{model.downloads}</span>
            </div>
          )}
          {model.size && (
            <div className="hub-meta-item">
              <HardDrive size={13} />
              <span>{model.size}</span>
            </div>
          )}
        </div>
        {isDownloading ? (
          <div className="hub-download-progress" onClick={(e) => e.stopPropagation()}>
            <div className="model-progress-label">
              <span>Downloading...</span>
              <span>{downloadSpeed}</span>
            </div>
            <div className="model-progress-bar">
              <div className="model-progress-fill" style={{ width: `${Math.min(100, Math.max(0, downloadProgress))}%` }} />
            </div>
            <button
              className="m3-btn m3-btn-error"
              style={{ marginTop: "8px", height: "32px", padding: "0 14px", width: "100%" }}
              onClick={handleCancelDownload}
            >
              <X size={14} /> Cancel
            </button>
          </div>
        ) : (
          <button
            className="m3-btn m3-btn-filled"
            style={{ marginTop: "auto", width: "100%" }}
            onClick={(e) => { e.stopPropagation(); handleDownload(model); }}
            disabled={!!downloadingModelId}
          >
            <DownloadCloud size={15} />
            Download
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="workspace-area">
      <div className="workspace-title-section">
        <h2 className="workspace-title">Model Hub</h2>
        <p className="workspace-subtitle">
          Browse, discover, and download models from the Hugging Face ecosystem.
        </p>
      </div>

      <div className="hub-trending-section">
        <div className="hub-trending-header">
          <TrendingUp size={20} className="hub-trending-icon" />
          <h3>Trending & Recommended</h3>
        </div>
        <div className="hub-trending-grid">
          {TRENDING_MODELS.map((model) => renderModelCard(model, true))}
        </div>
      </div>

      <div className="model-discovery-controls">
        <div className="model-search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search HuggingFace models..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button onClick={() => setQuery("")}>
              <X size={18} />
            </button>
          )}
        </div>
        <div className="model-filter-row">
          {CATEGORY_FILTERS.map((filter) => (
            <button
              key={filter.id}
              className={`model-filter-chip ${selectedFilters.includes(filter.id) ? "selected" : ""}`}
              onClick={() => toggleFilter(filter.id)}
            >
              <filter.icon size={14} />
              {filter.label}
            </button>
          ))}
          {selectedFilters.length > 0 && (
            <button className="model-filter-clear" onClick={() => setSelectedFilters([])}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {isSearching && (
        <div className="model-discovery-loading">
          <RefreshCw className="progress-spinner" size={16} />
          Searching Hugging Face...
        </div>
      )}

      {searchError && (
        <div className="model-search-warning">
          <AlertTriangle size={14} />
          {searchError}
        </div>
      )}

      {hasSearched && results.length === 0 && !isSearching && (
        <div className="model-search-empty">
          <p>No models found. Try a different search term or filters.</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="hub-results-grid">
          {results.map((model) => renderModelCard(model))}
        </div>
      )}

      {hasMore && (
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 24px" }}>
          <button
            className="m3-btn m3-btn-outlined model-load-more"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load More Models"}
          </button>
        </div>
      )}

      {!hasSearched && !isSearching && results.length === 0 && (
        <div className="hub-empty-state">
          <div className="hub-empty-icon">
            <Cloud size={36} />
          </div>
          <h3>Discover Models</h3>
          <p>
            Search for models on HuggingFace or pick from the trending selection above.
          </p>
        </div>
      )}

      {selectedModel && (
        <div className="app-dialog-backdrop" onClick={closeModal}>
          <div className="app-dialog hub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hub-modal-header">
              <h3 className="app-dialog-title">{selectedModel.name}</h3>
              <button className="hub-modal-close" onClick={closeModal}>
                <X size={20} />
              </button>
            </div>
            <div className="hub-modal-body">
              {selectedModel.notes && (
                <div className="hub-modal-section">
                  <div className="hub-modal-section-title">
                    <Info size={15} />
                    Description
                  </div>
                  <p className="hub-modal-description">{selectedModel.notes}</p>
                </div>
              )}
              <div className="hub-modal-section">
                <div className="hub-modal-section-title">
                  <BrainCircuit size={15} />
                  Model Details
                </div>
                <div className="hub-modal-details">
                  <div className="hub-detail-row">
                    <span className="hub-detail-label">Pipeline</span>
                    <span className="hub-detail-value">
                      <span className="hub-pipeline-tag">{selectedModel.pipeline || "Unknown"}</span>
                    </span>
                  </div>
                  {selectedModel.size && (
                    <div className="hub-detail-row">
                      <span className="hub-detail-label">Size</span>
                      <span className="hub-detail-value">{selectedModel.size}</span>
                    </div>
                  )}
                  {selectedModel.downloads && (
                    <div className="hub-detail-row">
                      <span className="hub-detail-label">Downloads</span>
                      <span className="hub-detail-value">{selectedModel.downloads}</span>
                    </div>
                  )}
                  <div className="hub-detail-row">
                    <span className="hub-detail-label">Est. VRAM</span>
                    <span className="hub-detail-value">
                      <Cpu size={13} />
                      {estimateVRAM(selectedModel.size)}
                    </span>
                  </div>
                  {selectedModel.tags?.length > 0 && (
                    <div className="hub-detail-row">
                      <span className="hub-detail-label">Tags</span>
                      <span className="hub-detail-value" style={{ gap: "4px", flexWrap: "wrap" }}>
                        {selectedModel.tags.map((tag) => (
                          <span key={tag} className="model-filter-chip selected" style={{ cursor: "default", minHeight: "26px", padding: "0 10px", fontSize: "0.75rem" }}>
                            {tag}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="hub-modal-section">
                <div className="hub-modal-section-title">
                  <Layers size={15} />
                  Quantization Options
                </div>
                <div className="hub-quant-options">
                  {["Q2_K", "Q3_K_M", "Q4_K_M", "Q5_K_M", "Q8_0", "F16"].map((q) => (
                    <div
                      key={q}
                      className={`hub-quant-chip ${q === "Q4_K_M" ? "hub-quant-recommended" : ""}`}
                    >
                      {q === "Q4_K_M" && <Star size={11} />}
                      {q}
                    </div>
                  ))}
                </div>
                <div className="hub-quant-hint">Q4_K_M recommended for best quality/speed balance</div>
              </div>
            </div>
            <div className="app-dialog-actions">
              <button className="m3-btn m3-btn-outlined" onClick={closeModal}>
                Close
              </button>
              <button
                className="m3-btn m3-btn-filled"
                onClick={() => { closeModal(); handleDownload(selectedModel); }}
                disabled={!!downloadingModelId}
              >
                <DownloadCloud size={15} />
                Download Model
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ModelHub);