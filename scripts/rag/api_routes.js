const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const RAG_DIR = __dirname;
const RAG_PYTHON_SCRIPT = path.join(RAG_DIR, "api_routes.py");
const RAG_TEMP = path.join(os.tmpdir(), "rag-uploads");

if (!fs.existsSync(RAG_TEMP)) fs.mkdirSync(RAG_TEMP, { recursive: true });

const PYTHON = _findPython();

function _findPython() {
  const candidates = ["python3", "python"];
  for (const cmd of candidates) {
    try {
      require("child_process").execSync(`${cmd} -c "import json"`, { stdio: "ignore" });
      return cmd;
    } catch (_) {}
  }
  return "python";
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    const limit = maxBytes || 64 * 1024 * 1024;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) { req.destroy(new Error("Request body too large")); return; }
      data += chunk;
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function parseMultipartBody(req, boundary) {
  return new Promise((resolve, reject) => {
    const bufs = [];
    req.on("data", (c) => bufs.push(c));
    req.on("end", () => {
      const buf = Buffer.concat(bufs);
      const parts = [];
      const delim = Buffer.from(`--${boundary}`);
      let pos = 0;
      while (pos < buf.length) {
        const start = buf.indexOf(delim, pos);
        if (start === -1) break;
        const end = buf.indexOf(delim, start + delim.length);
        if (end === -1) break;
        const section = buf.slice(start + delim.length + 2, end - 2);
        pos = end;
        if (section.length < 4) continue;
        const headerEnd = section.indexOf("\r\n\r\n");
        if (headerEnd === -1) continue;
        const headers = section.slice(0, headerEnd).toString();
        const content = section.slice(headerEnd + 4);
        const nameMatch = headers.match(/name="([^"]*)"/);
        const filenameMatch = headers.match(/filename="([^"]*)"/);
        parts.push({
          name: nameMatch ? nameMatch[1] : "",
          filename: filenameMatch ? filenameMatch[1] : null,
          data: content,
        });
      }
      resolve(parts);
    });
    req.on("error", reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

function callRagPython(command, payload) {
  return new Promise((resolve, reject) => {
    const args = [RAG_PYTHON_SCRIPT, command, JSON.stringify(payload || {})];
    const proc = spawn(PYTHON, args, {
      cwd: RAG_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 60000,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `Python exited with code ${code}`));
      }
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error(`Invalid JSON from RAG: ${stdout.slice(0, 200)}`)); }
    });
    proc.on("error", reject);
  });
}

async function handleRagRequest(req, res) {
  const url = req.url;
  const method = req.method;

  if (url === "/api/rag/ingest" && method === "POST") {
    try {
      const contentType = req.headers["content-type"] || "";
      let filePath = "";
      if (contentType.includes("multipart/form-data")) {
        const boundaryMatch = contentType.match(/boundary=(.+)/);
        if (!boundaryMatch) return json(res, 400, { ok: false, error: "Missing boundary" });
        const parts = await parseMultipartBody(req, boundaryMatch[1]);
        const filePart = parts.find(p => p.name === "file" && p.data.length > 0);
        if (!filePart) return json(res, 400, { ok: false, error: "No file uploaded" });
        const filename = filePart.filename || `upload-${Date.now()}`;
        filePath = path.join(RAG_TEMP, filename);
        fs.writeFileSync(filePath, filePart.data);
      } else {
        const body = await readJsonBody(req);
        filePath = body.filePath || body.file_path || "";
        if (!filePath || !fs.existsSync(filePath)) {
          return json(res, 400, { ok: false, error: "File not found" });
        }
      }
      const result = await callRagPython("ingest", { file_path: filePath });
      return json(res, 200, result);
    } catch (err) { return json(res, 500, { ok: false, error: err.message }); }
  }

  if (url === "/api/rag/documents" && method === "GET") {
    try { return json(res, 200, await callRagPython("list", {})); }
    catch (err) { return json(res, 500, { ok: false, error: err.message }); }
  }

  const deleteMatch = url.match(/^\/api\/rag\/documents\/(.+)$/);
  if (deleteMatch && method === "DELETE") {
    try { return json(res, 200, await callRagPython("delete", { document_id: decodeURIComponent(deleteMatch[1]) })); }
    catch (err) { return json(res, 500, { ok: false, error: err.message }); }
  }

  if (url === "/api/rag/search" && method === "POST") {
    try {
      const body = await readJsonBody(req);
      return json(res, 200, await callRagPython("search", { query: body.query, top_k: body.top_k || 10, alpha: body.alpha || 0.7 }));
    } catch (err) { return json(res, 500, { ok: false, error: err.message }); }
  }

  if (url === "/api/rag/chat" && method === "POST") {
    try {
      const body = await readJsonBody(req);
      return json(res, 200, await callRagPython("chat", { query: body.query, top_k: body.top_k || 5, alpha: body.alpha || 0.7 }));
    } catch (err) { return json(res, 500, { ok: false, error: err.message }); }
  }

  return false;
}

module.exports = { handleRagRequest };
