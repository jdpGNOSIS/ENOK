// api_routes.js — Voice Cloning & Streaming TTS API endpoints for Uncensored AI Studio
// Integrates with serve.cjs: call handleVoiceRequest(req, res) from the route chain

const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const VOICE_MODELS_DIR = path.join(ROOT, "app", "voice-models");
const TTS_OUTPUTS = path.join(ROOT, "app", "tts-outputs");
const TTS_CACHE = path.join(ROOT, "app", "tts-cache");
const TTS_RUNTIME = path.join(ROOT, "app", "tts-runtime");

const PYTHON = _findPython();
const VOICE_CLONER_PY = path.join(__dirname, "voice_cloner.py");
const STREAMING_TTS_PY = path.join(__dirname, "streaming_tts.py");
const VOICE_MANAGER_PY = path.join(__dirname, "voice_manager.py");

const PREVIEW_TEXT = "The quick brown fox jumps over the lazy dog. This voice was cloned using artificial intelligence.";

const TTS_VOICES = [
  { id: "af_heart", name: "Heart", language: "en-us", gender: "Female", type: "builtin" },
  { id: "af_bella", name: "Bella", language: "en-us", gender: "Female", type: "builtin" },
  { id: "af_nicole", name: "Nicole", language: "en-us", gender: "Female", type: "builtin" },
  { id: "af_sarah", name: "Sarah", language: "en-us", gender: "Female", type: "builtin" },
  { id: "am_michael", name: "Michael", language: "en-us", gender: "Male", type: "builtin" },
  { id: "am_fenrir", name: "Fenrir", language: "en-us", gender: "Male", type: "builtin" },
  { id: "bf_emma", name: "Emma", language: "en-gb", gender: "Female", type: "builtin" },
  { id: "bm_george", name: "George", language: "en-gb", gender: "Male", type: "builtin" },
];

function _findPython() {
  const candidates = ["python3", "python"];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} -c "import json"`, { stdio: "ignore" });
      return cmd;
    } catch (_) {}
  }
  return "python";
}

function _readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch (e) { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function _readBinaryBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function _json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function _callVoiceBridge(scriptPath, method, payload) {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify({ method, payload }) + "\n";

    // voice_*.py scripts take command as argv[1], params as argv[2]
    const proc = spawn(PYTHON, [scriptPath, method, JSON.stringify(payload)], {
      cwd: __dirname,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: 120000,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0) {
        const msg = (stderr || stdout || "").trim().slice(0, 500);
        return reject(new Error(`Voice bridge exited code ${code}: ${msg}`));
      }
      try {
        const lines = stdout.trim().split("\n");
        const last = lines[lines.length - 1];
        resolve(JSON.parse(last));
      } catch (e) {
        reject(new Error(`Voice bridge parse error: ${e.message}`));
      }
    });
    proc.stdin.end(input);
  });
}

function _callCloner(method, payload) {
  return _callVoiceBridge(VOICE_CLONER_PY, method, payload);
}

function _callStreamingTts(method, payload) {
  return _callVoiceBridge(STREAMING_TTS_PY, method, payload);
}

function _callVoiceManager(method, payload) {
  return _callVoiceBridge(VOICE_MANAGER_PY, method, payload);
}

function _readClonedVoices() {
  const voices = [];
  if (!fs.existsSync(VOICE_MODELS_DIR)) return voices;
  try {
    for (const entry of fs.readdirSync(VOICE_MODELS_DIR)) {
      if (entry.endsWith(".json")) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(VOICE_MODELS_DIR, entry), "utf8"));
          meta.type = "cloned";
          voices.push(meta);
        } catch (_) {}
      }
    }
  } catch (_) {}
  return voices;
}

async function handleVoiceRequest(req, res) {
  const url = req.url || "";

  // GET /api/voice/list — List available voices (built-in + cloned)
  if (url === "/api/voice/list" && req.method === "GET") {
    const cloned = _readClonedVoices();
    return _json(res, 200, {
      ok: true,
      voices: [...TTS_VOICES, ...cloned],
    });
  }

  // POST /api/voice/clone — Clone from uploaded audio
  if (url === "/api/voice/clone" && req.method === "POST") {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data") || contentType.includes("audio/")) {
      try {
        const audioBuffer = await _readBinaryBody(req);
        const voiceId = `cloned_${Date.now()}`;
        const audioPath = path.join(VOICE_MODELS_DIR, `${voiceId}_source.wav`);
        fs.mkdirSync(VOICE_MODELS_DIR, { recursive: true });
        fs.writeFileSync(audioPath, audioBuffer);

        const result = await _callCloner("clone", {
          audio_file: audioPath,
          reference_text: req.headers["x-reference-text"] || "",
          target_text: req.headers["x-target-text"] || "Hello, this is my cloned voice.",
          output: path.join(VOICE_MODELS_DIR, `${voiceId}.wav`),
        });

        try { fs.unlinkSync(audioPath); } catch (_) {}

        const metadata = {
          id: voiceId,
          name: req.headers["x-voice-name"] || `Cloned Voice ${new Date().toLocaleDateString()}`,
          createdAt: new Date().toISOString(),
          sourceFormat: path.extname(req.headers["x-filename"] || "audio.wav"),
          sampleFile: `${voiceId}.wav`,
        };
        const metaPath = path.join(VOICE_MODELS_DIR, `${voiceId}.json`);
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), "utf8");

        return _json(res, 200, { ok: true, voice: metadata });
      } catch (err) {
        return _json(res, 500, { ok: false, error: err.message });
      }
    } else {
      const body = await _readJsonBody(req).catch(() => ({}));
      if (!body.audio_file) {
        return _json(res, 400, { ok: false, error: "audio_file (path) or audio upload required" });
      }
      try {
        const voiceId = `cloned_${Date.now()}`;
        const result = await _callCloner("clone", {
          audio_file: body.audio_file,
          reference_text: body.reference_text || "",
          target_text: body.target_text || "Hello, this is my cloned voice.",
          output: path.join(VOICE_MODELS_DIR, `${voiceId}.wav`),
        });

        const metadata = {
          id: voiceId,
          name: body.name || `Cloned Voice ${new Date().toLocaleDateString()}`,
          createdAt: new Date().toISOString(),
          sampleFile: `${voiceId}.wav`,
        };
        const metaPath = path.join(VOICE_MODELS_DIR, `${voiceId}.json`);
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), "utf8");

        return _json(res, 200, { ok: true, voice: metadata });
      } catch (err) {
        return _json(res, 500, { ok: false, error: err.message });
      }
    }
  }

  // POST /api/voice/speak-stream — Streaming TTS endpoint (SSE)
  if (url === "/api/voice/speak-stream" && req.method === "POST") {
    const body = await _readJsonBody(req).catch(() => ({}));
    const text = String(body.text || "").trim();
    if (!text) {
      return _json(res, 400, { ok: false, error: "text is required" });
    }

    const voice = String(body.voice || "af_heart");
    const speed = Math.max(0.5, Math.min(2, Number(body.speed) || 1));
    const streamId = `sse_${Date.now()}`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });
    res.flushHeaders();

    res.write(`event: start\ndata: ${JSON.stringify({ stream_id: streamId, voice })}\n\n`);

    try {
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const result = await _callStreamingTts("speak", {
          text: sentence,
          voice,
          speed,
        });

        if (result.pcm_base64) {
          res.write(`event: audio\ndata: ${JSON.stringify({
            pcm_base64: result.pcm_base64,
            bytes: result.bytes,
            sample_rate: result.sample_rate || 24000,
            stream_id: streamId,
            chunk_index: i,
          })}\n\n`);
        }
      }

      res.write(`event: done\ndata: ${JSON.stringify({ stream_id: streamId })}\n\n`);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message, stream_id: streamId })}\n\n`);
    }

    res.end();
    return;
  }

  // GET /api/voice/preview — Generate a preview sentence for a voice
  if (url === "/api/voice/preview" && req.method === "POST") {
    const body = await _readJsonBody(req).catch(() => ({}));
    const voiceId = String(body.voice_id || "");
    if (!voiceId) {
      return _json(res, 400, { ok: false, error: "voice_id is required" });
    }
    try {
      const result = await _callVoiceManager("preview", {
        voice_id: voiceId,
        text: body.text || PREVIEW_TEXT,
      });
      if (!result.ok) {
        return _json(res, 500, { ok: false, error: result.error || "Preview generation failed" });
      }
      const previewPath = result.path;
      if (previewPath && fs.existsSync(previewPath)) {
        const data = fs.readFileSync(previewPath);
        res.writeHead(200, {
          "Content-Type": "audio/wav",
          "Access-Control-Allow-Origin": "*",
          "Content-Length": data.length,
        });
        res.end(data);
        return;
      }
      return _json(res, 500, { ok: false, error: "Preview file not found" });
    } catch (err) {
      return _json(res, 500, { ok: false, error: err.message });
    }
  }

  // DELETE /api/voice/:id — Delete a cloned voice
  const deleteMatch = url.match(/^\/api\/voice\/([^/]+)$/);
  if (deleteMatch && req.method === "DELETE") {
    const voiceId = deleteMatch[1];
    try {
      const result = await _callVoiceManager("delete", { voice_id: voiceId });
      return _json(res, 200, { ok: true, deleted: result.deleted });
    } catch (err) {
      return _json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/voice/interpolate — Interpolate between two voices
  if (url === "/api/voice/interpolate" && req.method === "POST") {
    const body = await _readJsonBody(req).catch(() => ({}));
    if (!body.voice_a || !body.voice_b) {
      return _json(res, 400, { ok: false, error: "voice_a and voice_b are required" });
    }
    try {
      const result = await _callVoiceManager("interpolate", {
        voice_a: body.voice_a,
        voice_b: body.voice_b,
        alpha: Number(body.alpha) || 0.5,
      });
      return _json(res, 200, result);
    } catch (err) {
      return _json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/voice/status — Voice system status
  if (url === "/api/voice/status" && req.method === "GET") {
    try {
      const clonerStatus = await _callCloner("status", {});
      const streamStatus = await _callStreamingTts("status", {});
      return _json(res, 200, {
        ok: true,
        cloner: clonerStatus,
        streaming: streamStatus,
        voicesDir: VOICE_MODELS_DIR,
        voicesCount: _readClonedVoices().length,
      });
    } catch (err) {
      return _json(res, 200, {
        ok: true,
        cloner: { ok: false, error: err.message },
        streaming: { ok: false },
        voicesDir: VOICE_MODELS_DIR,
        voicesCount: 0,
      });
    }
  }

  return false; // not a voice route
}

module.exports = { handleVoiceRequest };
