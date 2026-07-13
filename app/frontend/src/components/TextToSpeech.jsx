import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LoaderCircle,
  Mic,
  Play,
  RefreshCw,
  Save,
  Square,
  Trash2,
  Upload,
  Volume2,
  Radio,
} from "lucide-react";
import {
  getTtsStatus,
  listTtsModels,
  speakTts,
  startTts,
  stopTts,
  listVoiceCloningVoices,
  cloneVoice,
  deleteClonedVoice,
  streamTts,
  generateVoicePreview,
  interpolateVoices,
} from "../services/api";

const FALLBACK_VOICES = [
  { id: "af_heart", name: "Heart", language: "en-us", gender: "Female" },
  { id: "af_bella", name: "Bella", language: "en-us", gender: "Female" },
  { id: "am_michael", name: "Michael", language: "en-us", gender: "Male" },
  { id: "bf_emma", name: "Emma", language: "en-gb", gender: "Female" },
  { id: "bm_george", name: "George", language: "en-gb", gender: "Male" },
];

function downloadUrl(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

const TAB_SYNTHESIS = "synthesis";
const TAB_CLONING = "cloning";
const TAB_INTERPOLATION = "interpolation";

export default function TextToSpeech({
  showAlert,
  selectedOutput,
  onOutputsChanged,
  ttsSettings,
  setTtsSettings,
}) {
  const [status, setStatus] = useState({ ready: false, running: false, runtimeInstalled: false, settings: {}, voices: [] });
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [text, setText] = useState("Hello from Local AI Studio text to speech.");
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [output, setOutput] = useState(null);
  const abortRef = useRef(null);
  const [activeTab, setActiveTab] = useState(TAB_SYNTHESIS);
  const [clonedVoices, setClonedVoices] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(false);
  const [interpVoiceA, setInterpVoiceA] = useState("af_heart");
  const [interpVoiceB, setInterpVoiceB] = useState("af_bella");
  const [interpAlpha, setInterpAlpha] = useState(0.5);
  const [interpResult, setInterpResult] = useState(null);

  const installedModels = useMemo(() => models.filter((model) => model.installed), [models]);
  const voices = status.voices?.length ? status.voices : FALLBACK_VOICES;
  const allVoices = useMemo(() => [...voices, ...clonedVoices], [voices, clonedVoices]);
  const selectedVoice = ttsSettings?.voice || "af_heart";
  const speed = ttsSettings?.speed || 1;

  const updateTtsSetting = (key, value) => {
    setTtsSettings((prev) => ({ ...prev, [key]: value }));
  };

  const fetchClonedVoices = useCallback(async () => {
    try {
      const voices = await listVoiceCloningVoices();
      setClonedVoices(voices.filter((v) => v.type === "cloned"));
    } catch (_) {}
  }, []);

  const refresh = useCallback(async () => {
    const [nextStatus, nextModels] = await Promise.all([
      getTtsStatus(),
      listTtsModels(),
    ]);
    setStatus(nextStatus);
    setModels(nextModels);
    setSelectedModel((current) => {
      const installed = nextModels.filter((model) => model.installed);
      if (current && installed.some((model) => model.filename === current || model.id === current)) return current;
      const active = nextStatus.settings?.model;
      if (active && installed.some((model) => model.filename === active)) return active;
      const preferred = ttsSettings?.model;
      if (preferred && installed.some((model) => model.filename === preferred)) return preferred;
      return installed.find((model) => model.recommended)?.filename || installed[0]?.filename || "";
    });
    await fetchClonedVoices();
  }, [ttsSettings?.model, fetchClonedVoices]);

  useEffect(() => {
    refresh().catch((err) => showAlert?.({ title: "TTS Status Failed", message: err.message || String(err), danger: true }));
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, 2500);
    return () => clearInterval(interval);
  }, [refresh, showAlert]);

  useEffect(() => {
    if (!selectedOutput) return;
    setOutput(selectedOutput);
    setText(selectedOutput.text || "");
    if (selectedOutput.voice) updateTtsSetting("voice", selectedOutput.voice);
    if (selectedOutput.speed) updateTtsSetting("speed", selectedOutput.speed);
    if (selectedOutput.model) setSelectedModel(selectedOutput.model);
  }, [selectedOutput]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleLoadModel = async () => {
    if (!selectedModel) return;
    setIsLoadingModel(true);
    try {
      await startTts(selectedModel, { voice: selectedVoice, speed });
      updateTtsSetting("model", selectedModel);
      await refresh();
    } catch (err) {
      showAlert?.({ title: "TTS Model Load Failed", message: err.message || String(err), danger: true });
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopTts();
      await refresh();
    } catch (err) {
      showAlert?.({ title: "Stop TTS Failed", message: err.message || String(err), danger: true });
    }
  };

  const handleGenerate = async () => {
    if (!text.trim() || !selectedModel) return;
    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (!status.ready || status.settings?.model !== selectedModel) {
        setIsLoadingModel(true);
        try {
          await startTts(selectedModel, { voice: selectedVoice, speed });
          updateTtsSetting("model", selectedModel);
          await refresh();
        } finally {
          setIsLoadingModel(false);
        }
      }

      if (streamEnabled) {
        let audioChunks = [];
        await streamTts(text, {
          voice: selectedVoice,
          speed,
          signal: controller.signal,
        }, (chunk) => {
          if (chunk.pcm_base64) {
            const binaryStr = atob(chunk.pcm_base64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            audioChunks.push(bytes);
          }
        }, () => {
          const wavBlob = pcmToWav(audioChunks, 24000);
          const url = URL.createObjectURL(wavBlob);
          setOutput({ url, text, voice: selectedVoice, createdAt: new Date().toISOString() });
        });
      } else {
        const generated = await speakTts(text, {
          model: selectedModel,
          voice: selectedVoice,
          speed,
          signal: controller.signal,
        });
        setOutput(generated);
        await refresh();
        await onOutputsChanged?.();
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        showAlert?.({ title: "TTS Generation Failed", message: err.message || String(err), danger: true });
      }
    } finally {
      abortRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsGenerating(false);
  };

  const handleUploadAudio = async (file) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const voice = await cloneVoice(file, {
        name: file.name.replace(/\.[^.]+$/, "") || "Cloned Voice",
        referenceText: "",
        targetText: "Hello, this is my cloned voice.",
      });
      await fetchClonedVoices();
      showAlert?.({ title: "Voice Cloned", message: `"${voice.name}" created successfully.` });
    } catch (err) {
      showAlert?.({ title: "Voice Clone Failed", message: err.message || String(err), danger: true });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteClonedVoice = async (voiceId, voiceName) => {
    try {
      await deleteClonedVoice(voiceId);
      await fetchClonedVoices();
      setPreviewUrls((prev) => {
        const next = { ...prev };
        delete next[voiceId];
        return next;
      });
      showAlert?.({ title: "Voice Deleted", message: `"${voiceName}" deleted.` });
    } catch (err) {
      showAlert?.({ title: "Delete Failed", message: err.message || String(err), danger: true });
    }
  };

  const handlePreviewVoice = async (voiceId) => {
    if (previewUrls[voiceId]) return;
    try {
      const url = await generateVoicePreview(voiceId, "The quick brown fox jumps over the lazy dog. This is a preview of the voice.");
      setPreviewUrls((prev) => ({ ...prev, [voiceId]: url }));
    } catch (err) {
      showAlert?.({ title: "Preview Failed", message: err.message || String(err), danger: true });
    }
  };

  const handleInterpolate = async () => {
    try {
      const result = await interpolateVoices(interpVoiceA, interpVoiceB, interpAlpha);
      setInterpResult(result.interpolation);
      await fetchClonedVoices();
      showAlert?.({ title: "Interpolation Complete", message: `Voice blended at ${Math.round(interpAlpha * 100)}%.` });
    } catch (err) {
      showAlert?.({ title: "Interpolation Failed", message: err.message || String(err), danger: true });
    }
  };

  const isLoaded = status.ready && status.settings?.model === selectedModel;

  return (
    <div className="workspace-area speech-workspace">
      <div className="workspace-title-section">
        <h2 className="workspace-title">Text to Speech</h2>
        <p className="workspace-subtitle">
          Generate local WAV narration with Kokoro ONNX.
        </p>
      </div>

      <div className="speech-tabs" style={{ display: "flex", gap: "4px", marginBottom: "16px" }}>
        <button
          className={`m3-btn ${activeTab === TAB_SYNTHESIS ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveTab(TAB_SYNTHESIS)}
        >
          <Volume2 size={14} />
          <span>Synthesis</span>
        </button>
        <button
          className={`m3-btn ${activeTab === TAB_CLONING ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveTab(TAB_CLONING)}
        >
          <Mic size={14} />
          <span>Voice Clone</span>
        </button>
        <button
          className={`m3-btn ${activeTab === TAB_INTERPOLATION ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveTab(TAB_INTERPOLATION)}
        >
          <Radio size={14} />
          <span>Interpolate</span>
        </button>
      </div>

      {activeTab === TAB_SYNTHESIS && (
        <>
          <div className="speech-grid">
            <section className="m3-card speech-panel">
              <div className="speech-panel-header">
                <h3>Runtime</h3>
                <span className={`status-chip ${status.runtimeInstalled ? "" : "offline"}`}>
                  {status.runtimeInstalled ? (status.ready ? "Ready" : "Installed") : "Runtime missing"}
                </span>
              </div>

              {status.error && <div className="text-progress error">{status.error}</div>}

              <label className="speech-label">
                Kokoro model
                <select className="m3-input" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                  {installedModels.length === 0 && <option value="">No downloaded TTS models</option>}
                  {installedModels.map((model) => (
                    <option key={model.id || model.filename} value={model.filename}>
                      {model.name || model.filename}
                    </option>
                  ))}
                </select>
              </label>

              <div className="speech-controls-row">
                <label className="speech-label">
                  Voice
                  <select className="m3-input" value={selectedVoice} onChange={(event) => updateTtsSetting("voice", event.target.value)}>
                    {allVoices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name} ({voice.gender || voice.type || "unknown"}, {voice.language || "mixed"})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="speech-label">
                  Speed
                  <input
                    className="m3-input"
                    type="number"
                    min="0.5"
                    max="2"
                    step="0.05"
                    value={speed}
                    onChange={(event) => updateTtsSetting("speed", Math.max(0.5, Math.min(2, Number(event.target.value) || 1)))}
                  />
                </label>
              </div>

              <div className="speech-controls-row">
                <label className="speech-label" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={streamEnabled}
                    onChange={(e) => setStreamEnabled(e.target.checked)}
                  />
                  Streaming playback
                </label>
              </div>

              <div className="speech-button-row">
                <button
                  className="m3-btn m3-btn-filled"
                  onClick={handleLoadModel}
                  disabled={!selectedModel || isLoadingModel || isGenerating || isLoaded}
                >
                  {isLoadingModel ? <LoaderCircle className="progress-spinner" size={14} /> : <Play size={14} />}
                  <span>{isLoaded ? "Loaded" : isLoadingModel ? "Loading" : "Load"}</span>
                </button>
                <button className="m3-btn m3-btn-outlined" onClick={refresh}>
                  <RefreshCw size={14} />
                  <span>Refresh</span>
                </button>
                {status.ready && (
                  <button className="m3-btn m3-btn-error" onClick={handleStop}>
                    <Square size={14} />
                    <span>Stop Runtime</span>
                  </button>
                )}
              </div>

              {installedModels.length === 0 && (
                <div className="text-progress">
                  Download a Kokoro model from Model Manager, TTS Models first.
                </div>
              )}
            </section>

            <section className="m3-card speech-panel">
              <div className="speech-panel-header">
                <h3>Input</h3>
                <span className="status-chip">{text.trim().length} chars</span>
              </div>
              <textarea
                className="m3-input"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={10}
                maxLength={5000}
                style={{ width: "100%", resize: "vertical", minHeight: "220px", lineHeight: 1.45 }}
                placeholder="Type text to turn into speech..."
              />
              <div className="speech-button-row">
                {isGenerating ? (
                  <button className="m3-btn m3-btn-error" onClick={handleCancel}>
                    <Square size={14} />
                    <span>Cancel</span>
                  </button>
                ) : (
                  <button
                    className="m3-btn m3-btn-filled"
                    onClick={handleGenerate}
                    disabled={!text.trim() || !selectedModel || !status.runtimeInstalled}
                  >
                    <Volume2 size={14} />
                    <span>{streamEnabled ? "Stream" : "Generate WAV"}</span>
                  </button>
                )}
                {isGenerating && <span className="text-progress"><LoaderCircle className="progress-spinner" size={14} /> {streamEnabled ? "Streaming..." : "Generating locally..."}</span>}
              </div>
            </section>
          </div>

          <section className="m3-card speech-result-panel">
            <div className="speech-panel-header">
              <h3>Output</h3>
              <div className="speech-button-row">
                <button className="m3-btn m3-btn-outlined" onClick={() => output?.url && downloadUrl(output.url, output.audioFile || "tts.wav")} disabled={!output?.url}>
                  <Save size={14} />
                  <span>WAV</span>
                </button>
              </div>
            </div>
            {output?.url ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <audio controls src={output.url} style={{ width: "100%" }} />
                <div className="text-progress">
                  {output.voiceName || output.voice} &bull; {output.modelName || output.model} &bull; {new Date(output.createdAt).toLocaleString()}
                </div>
                <textarea
                  className="m3-input"
                  value={output.text || text}
                  onChange={(event) => setOutput((prev) => ({ ...(prev || {}), text: event.target.value }))}
                  rows={5}
                  style={{ width: "100%", resize: "vertical", minHeight: "120px", lineHeight: 1.45 }}
                />
              </div>
            ) : (
              <div className="empty-state" style={{ padding: "32px 0" }}>
                <Volume2 size={42} />
                <p>Generated speech will appear here.</p>
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === TAB_CLONING && (
        <div className="speech-grid">
          <section className="m3-card speech-panel">
            <div className="speech-panel-header">
              <h3>Clone Voice</h3>
            </div>
            <p className="text-progress" style={{ marginBottom: "12px" }}>
              Upload a WAV/MP3 file with ~3 seconds of clear speech to clone the voice.
            </p>
            <div
              className="upload-zone"
              style={{
                border: "2px dashed var(--m3-outline, #666)",
                borderRadius: "12px",
                padding: "40px 20px",
                textAlign: "center",
                cursor: "pointer",
                marginBottom: "12px",
              }}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--m3-primary)"; }}
              onDragLeave={(e) => { e.currentTarget.style.borderColor = "var(--m3-outline, #666)"; }}
              onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) handleUploadAudio(file); }}
              onClick={() => document.getElementById("audio-upload-input").click()}
            >
              <Upload size={32} style={{ marginBottom: "8px", opacity: 0.6 }} />
              <p>Click or drag audio here</p>
              <input
                id="audio-upload-input"
                type="file"
                accept="audio/wav,audio/mpeg,audio/ogg,audio/webm"
                style={{ display: "none" }}
                onChange={(e) => { const file = e.target.files[0]; if (file) handleUploadAudio(file); }}
              />
            </div>
            {isUploading && (
              <div className="text-progress">
                <LoaderCircle className="progress-spinner" size={14} /> Cloning voice...
              </div>
            )}
          </section>

          <section className="m3-card speech-panel">
            <div className="speech-panel-header">
              <h3>Cloned Voices</h3>
              <span className="status-chip">{clonedVoices.length} voices</span>
            </div>
            {clonedVoices.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px 0" }}>
                <Mic size={32} />
                <p>No cloned voices yet.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {clonedVoices.map((voice) => (
                  <div
                    key={voice.id}
                    className="voice-card"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      background: "var(--m3-surface-variant, rgba(255,255,255,0.05))",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                      <Mic size={16} />
                      <div style={{ overflow: "hidden" }}>
                        <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{voice.name}</div>
                        <div className="text-progress" style={{ fontSize: "11px" }}>
                          {new Date(voice.createdAt || Date.now()).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                      {previewUrls[voice.id] ? (
                        <audio
                          controls
                          src={previewUrls[voice.id]}
                          style={{ width: "120px", height: "28px" }}
                          onPlay={() => handlePreviewVoice(voice.id)}
                        />
                      ) : (
                        <button
                          className="m3-btn m3-btn-outlined"
                          style={{ padding: "4px 8px", fontSize: "12px" }}
                          onClick={() => handlePreviewVoice(voice.id)}
                          title="Preview"
                        >
                          <Play size={12} />
                        </button>
                      )}
                      <button
                        className="m3-btn m3-btn-error"
                        style={{ padding: "4px 8px", fontSize: "12px" }}
                        onClick={() => handleDeleteClonedVoice(voice.id, voice.name)}
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === TAB_INTERPOLATION && (
        <div className="speech-grid" style={{ gridTemplateColumns: "1fr" }}>
          <section className="m3-card speech-panel">
            <div className="speech-panel-header">
              <h3>Voice Interpolation</h3>
            </div>
            <p className="text-progress" style={{ marginBottom: "16px" }}>
              Blend two voices together using a slider.
            </p>

            <div className="speech-controls-row">
              <label className="speech-label">
                Voice A
                <select className="m3-input" value={interpVoiceA} onChange={(e) => setInterpVoiceA(e.target.value)}>
                  {allVoices.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} ({v.type || "builtin"})</option>
                  ))}
                </select>
              </label>
              <label className="speech-label">
                Voice B
                <select className="m3-input" value={interpVoiceB} onChange={(e) => setInterpVoiceB(e.target.value)}>
                  {allVoices.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} ({v.type || "builtin"})</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="speech-label" style={{ marginTop: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span>{allVoices.find((v) => v.id === interpVoiceA)?.name || interpVoiceA}</span>
                <span>{allVoices.find((v) => v.id === interpVoiceB)?.name || interpVoiceB}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={interpAlpha}
                onChange={(e) => setInterpAlpha(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <div style={{ textAlign: "center", marginTop: "4px", fontWeight: 500 }}>
                Blend: {Math.round(interpAlpha * 100)}% B / {Math.round((1 - interpAlpha) * 100)}% A
              </div>
            </div>

            <div className="speech-button-row" style={{ marginTop: "16px" }}>
              <button className="m3-btn m3-btn-filled" onClick={handleInterpolate}>
                <Radio size={14} />
                <span>Interpolate</span>
              </button>
            </div>

            {interpResult && (
              <div className="m3-card" style={{ marginTop: "16px", padding: "12px" }}>
                <div className="text-progress">Created: {interpResult.name}</div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function pcmToWav(chunks, sampleRate) {
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const buffer = new ArrayBuffer(44 + totalLen);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + totalLen, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, totalLen, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      view.setUint8(offset + i, chunk[i]);
    }
    offset += chunk.length;
  }
  return new Blob([buffer], { type: "audio/wav" });
}
