// api_routes.js — Agent API endpoints for Uncensored AI Studio
// Integrates with serve.cjs: call handleAgentRequest(req, res) from the route chain

const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");

const AGENTS_DIR = __dirname;
const AGENT_PYTHON_SCRIPT = path.join(AGENTS_DIR, "_api_bridge.py");

const PYTHON = _findPython();

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

function _json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function _callAgentBridge(method, payload) {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify({ method, payload }) + "\n";
    const proc = spawn(PYTHON, [AGENT_PYTHON_SCRIPT], {
      cwd: AGENTS_DIR,
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
        return reject(new Error(`Agent bridge exited code ${code}: ${msg}`));
      }
      try {
        const lines = stdout.trim().split("\n");
        const last = lines[lines.length - 1];
        resolve(JSON.parse(last));
      } catch (e) {
        reject(new Error(`Agent bridge parse error: ${e.message}`));
      }
    });
    proc.stdin.end(input);
  });
}

let _customTools = [];

async function handleAgentRequest(req, res) {
  const url = req.url || "";

  // GET /api/agent/tools — List available tools
  if (url === "/api/agent/tools" && req.method === "GET") {
    try {
      const result = await _callAgentBridge("list_tools", {});
      return _json(res, 200, {
        ok: true,
        tools: result.tools || [],
        custom_tools: _customTools.map((t) => t.def),
      });
    } catch (err) {
      return _json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/agent/chat — Chat with agent (auto tool use)
  if (url === "/api/agent/chat" && req.method === "POST") {
    const body = await _readJsonBody(req).catch(() => ({}));
    if (!body.message && !body.messages) {
      return _json(res, 400, { ok: false, error: "message or messages is required" });
    }
    try {
      const result = await _callAgentBridge("chat", {
        user_message: body.message || "",
        messages: body.messages || [],
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 2048,
        extra_context: body.extra_context || "",
        llm_endpoint: body.llm_endpoint || "",
        reset: body.reset === true,
      });
      return _json(res, 200, { ok: true, ...result.result });
    } catch (err) {
      return _json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/agent/execute — Execute a specific tool
  if (url === "/api/agent/execute" && req.method === "POST") {
    const body = await _readJsonBody(req).catch(() => ({}));
    if (!body.tool) {
      return _json(res, 400, { ok: false, error: "tool name is required" });
    }
    try {
      const result = await _callAgentBridge("execute_tool", {
        tool: body.tool,
        arguments: body.arguments || {},
      });
      return _json(res, 200, { ok: true, ...result.result });
    } catch (err) {
      return _json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/agent/custom-tool — Register a custom tool (plugin support)
  if (url === "/api/agent/custom-tool" && req.method === "POST") {
    const body = await _readJsonBody(req).catch(() => ({}));
    if (!body.name || !body.handler) {
      return _json(res, 400, {
        ok: false,
        error: "name and handler (script path) are required",
      });
    }
    const toolEntry = {
      def: {
        type: "function",
        function: {
          name: body.name,
          description: body.description || "Custom tool",
          parameters: body.parameters || { type: "object", properties: {} },
        },
      },
      handler: body.handler,
      handler_type: body.handler_type || "script",
    };
    _customTools.push(toolEntry);
    return _json(res, 200, {
      ok: true,
      message: `Custom tool '${body.name}' registered`,
      tool: toolEntry.def,
    });
  }

  // POST /api/agent/reset — Reset conversation
  if (url === "/api/agent/reset" && req.method === "POST") {
    try {
      const result = await _callAgentBridge("reset", {});
      return _json(res, 200, { ok: true, message: result.message || "Conversation reset" });
    } catch (err) {
      return _json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/agent/system-prompt — Set custom system prompt
  if (url === "/api/agent/system-prompt" && req.method === "POST") {
    const body = await _readJsonBody(req).catch(() => ({}));
    if (!body.prompt) {
      return _json(res, 400, { ok: false, error: "prompt is required" });
    }
    try {
      const result = await _callAgentBridge("set_system_prompt", { prompt: body.prompt });
      return _json(res, 200, { ok: true, message: result.message || "System prompt updated" });
    } catch (err) {
      return _json(res, 500, { ok: false, error: err.message });
    }
  }

  return false; // not an agent route
}

module.exports = {
  handleAgentRequest,
  _customTools: () => _customTools,
};
