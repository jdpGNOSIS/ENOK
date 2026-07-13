const https = require("https");
const http = require("http");

function createPluginAPI(pluginId, settingsStore) {
  const tools = new Map();
  const panels = new Map();
  const commands = new Map();

  const api = {
    registerTool(name, description, parameters, handler) {
      if (typeof name !== "string" || !name) throw new Error("registerTool: 'name' must be a non-empty string");
      if (typeof handler !== "function") throw new Error("registerTool: 'handler' must be a function");
      tools.set(name, { name, description: description || "", parameters: parameters || {}, handler, pluginId });
    },

    registerPanel(name, component) {
      if (typeof name !== "string" || !name) throw new Error("registerPanel: 'name' must be a non-empty string");
      panels.set(name, { name, component, pluginId });
    },

    registerCommand(name, handler) {
      if (typeof name !== "string" || !name) throw new Error("registerCommand: 'name' must be a non-empty string");
      if (typeof handler !== "function") throw new Error("registerCommand: 'handler' must be a function");
      commands.set(name, { name, handler, pluginId });
    },

    getSetting(key) {
      if (!settingsStore) return undefined;
      return settingsStore.get(pluginId, key);
    },

    setSetting(key, value) {
      if (!settingsStore) return;
      settingsStore.set(pluginId, key, value);
    },

    logInfo(msg) {
      console.log(`  [plugin:${pluginId}] ${msg}`);
    },

    logError(msg) {
      console.error(`  [plugin:${pluginId}] ${msg}`);
    },

    fetchJson(url, options = {}) {
      return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === "https:" ? https : http;
        const req = client.get(url, { headers: options.headers || {}, ...options }, (res) => {
          let data = "";
          const maxBytes = options.maxBytes || 5 * 1024 * 1024;
          let bytes = 0;
          res.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > maxBytes) {
              req.destroy(new Error("Response too large"));
              return;
            }
            data += chunk;
          });
          res.on("end", () => {
            try {
              resolve({ ok: true, status: res.statusCode, data: JSON.parse(data || "null") });
            } catch (e) {
              resolve({ ok: true, status: res.statusCode, raw: data });
            }
          });
        });
        req.on("error", reject);
        if (options.timeoutMs) req.setTimeout(options.timeoutMs, () => { req.destroy(new Error("Request timed out")); });
      });
    },

    getActiveModel() {
      try {
        const llmSettingsPath = require("path").join(__dirname, "..", "..", "app", "config", "llm-settings.json");
        const data = require("fs").readFileSync(llmSettingsPath, "utf-8");
        return JSON.parse(data);
      } catch {
        return null;
      }
    },

    getConversation() {
      try {
        const convPath = require("path").join(__dirname, "..", "..", "app", "config", "conversation.json");
        const data = require("fs").readFileSync(convPath, "utf-8");
        return JSON.parse(data);
      } catch {
        return [];
      }
    },
  };

  return { api, tools, panels, commands };
}

module.exports = { createPluginAPI };
