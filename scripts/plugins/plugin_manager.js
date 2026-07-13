const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { getRegistry, loadPlugin, unloadPlugin, loadAllPlugins, initPlugins } = require("./plugin_loader");
const { createPluginAPI } = require("./plugin_api");

const CONFIG_PATH = path.join(__dirname, "..", "..", "app", "config", "plugins.json");
const PLUGINS_DIR = path.join(__dirname, "..", "..", "app", "plugins");

let pluginApis = new Map();
let pluginTools = new Map();
let pluginPanels = new Map();
let pluginCommands = new Map();

const settingsStore = {
  _data: null,
  _dirty: false,

  _load() {
    if (this._data) return;
    try {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      this._data = JSON.parse(raw);
    } catch {
      this._data = { plugins: {}, settings: {} };
    }
  },

  _save() {
    if (!this._dirty) return;
    try {
      const dir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this._data, null, 2), "utf-8");
      this._dirty = false;
    } catch (err) {
      console.error("  [plugins] Failed to save plugins config:", err.message);
    }
  },

  get(pluginId, key) {
    this._load();
    const pluginSettings = this._data.settings[pluginId];
    return pluginSettings ? pluginSettings[key] : undefined;
  },

  set(pluginId, key, value) {
    this._load();
    if (!this._data.settings[pluginId]) this._data.settings[pluginId] = {};
    this._data.settings[pluginId][key] = value;
    this._dirty = true;
    this._save();
  },

  isEnabled(pluginId) {
    this._load();
    if (this._data.plugins[pluginId] === false) return false;
    return this._data.plugins[pluginId] !== false;
  },

  setEnabled(pluginId, enabled) {
    this._load();
    this._data.plugins[pluginId] = enabled;
    this._dirty = true;
    this._save();
  },
};

function initPluginSystem() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ plugins: {}, settings: {} }, null, 2), "utf-8");
  }
  loadAllPlugins();
  const registry = getRegistry();
  for (const [id, entry] of registry) {
    if (!settingsStore.isEnabled(id)) {
      entry.enabled = false;
      continue;
    }
    const { api, tools, panels, commands } = createPluginAPI(id, settingsStore);
    pluginApis.set(id, api);
    pluginTools.set(id, tools);
    pluginPanels.set(id, panels);
    pluginCommands.set(id, commands);
  }
  const results = [];
  for (const [id, entry] of registry) {
    if (!entry.enabled) continue;
    const api = pluginApis.get(id);
    try {
      entry.instance.init(api);
      results.push({ id, status: "ok" });
    } catch (err) {
      console.error(`  [plugins] init() failed for "${entry.name}":`, err.message);
      results.push({ id, status: "error", error: err.message });
    }
  }
  return results;
}

function listPlugins() {
  const registry = getRegistry();
  const items = [];
  for (const [id, entry] of registry) {
    items.push({
      id,
      name: entry.name,
      version: entry.version,
      enabled: settingsStore.isEnabled(id),
      filePath: entry.filePath,
      loadedAt: entry.loadedAt,
      toolCount: (pluginTools.get(id) || new Map()).size,
      panelCount: (pluginPanels.get(id) || new Map()).size,
      commandCount: (pluginCommands.get(id) || new Map()).size,
    });
  }
  return items;
}

function enablePlugin(id) {
  const registry = getRegistry();
  const entry = registry.get(id);
  if (!entry) return { ok: false, error: `Plugin "${id}" not found` };
  settingsStore.setEnabled(id, true);
  entry.enabled = true;
  const { api, tools, panels, commands } = createPluginAPI(id, settingsStore);
  pluginApis.set(id, api);
  pluginTools.set(id, tools);
  pluginPanels.set(id, panels);
  pluginCommands.set(id, commands);
  try {
    entry.instance.init(api);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function disablePlugin(id) {
  const registry = getRegistry();
  const entry = registry.get(id);
  if (!entry) return { ok: false, error: `Plugin "${id}" not found` };
  settingsStore.setEnabled(id, false);
  entry.enabled = false;
  if (entry.instance.unload && typeof entry.instance.unload === "function") {
    try { entry.instance.unload(); } catch (err) { /* ignore */ }
  }
  pluginApis.delete(id);
  pluginTools.delete(id);
  pluginPanels.delete(id);
  pluginCommands.delete(id);
  return { ok: true };
}

function installPlugin(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const filename = path.basename(parsed.pathname);
    if (!/\.m?js$/.test(filename)) {
      return reject(new Error("Plugin URL must point to a .js or .mjs file"));
    }
    const targetPath = path.join(PLUGINS_DIR, filename);
    const client = parsed.protocol === "https:" ? https : http;
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      const file = fs.createWriteStream(targetPath);
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        const entry = loadPlugin(targetPath);
        if (!entry) {
          fs.unlinkSync(targetPath);
          return reject(new Error("Plugin validation failed after download"));
        }
        settingsStore.setEnabled(entry.id, true);
        const { api, tools, panels, commands } = createPluginAPI(entry.id, settingsStore);
        pluginApis.set(entry.id, api);
        pluginTools.set(entry.id, tools);
        pluginPanels.set(entry.id, panels);
        pluginCommands.set(entry.id, commands);
        try {
          entry.instance.init(api);
          resolve({ ok: true, id: entry.id, name: entry.name, version: entry.version });
        } catch (err) {
          resolve({ ok: true, id: entry.id, name: entry.name, version: entry.version, initError: err.message });
        }
      });
    }).on("error", reject);
  });
}

function uninstallPlugin(id) {
  const registry = getRegistry();
  const entry = registry.get(id);
  if (!entry) return { ok: false, error: `Plugin "${id}" not found` };
  disablePlugin(id);
  unloadPlugin(id);
  settingsStore.setEnabled(id, undefined);
  try {
    if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getPluginApis() {
  return pluginApis;
}

function getPluginTools() {
  return pluginTools;
}

function getPluginPanels() {
  return pluginPanels;
}

function getPluginCommands() {
  return pluginCommands;
}

function getSettingsStore() {
  return settingsStore;
}

module.exports = {
  initPluginSystem,
  listPlugins,
  enablePlugin,
  disablePlugin,
  installPlugin,
  uninstallPlugin,
  getPluginApis,
  getPluginTools,
  getPluginPanels,
  getPluginCommands,
  getSettingsStore,
};
