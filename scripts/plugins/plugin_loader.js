const fs = require("fs");
const path = require("path");

const PLUGINS_DIR = path.join(__dirname, "..", "..", "app", "plugins");

const registry = new Map();

function getRegistry() {
  return registry;
}

function findPluginFiles() {
  const results = [];
  if (!fs.existsSync(PLUGINS_DIR)) return results;
  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && /\.m?js$/.test(entry.name)) {
      results.push(path.join(PLUGINS_DIR, entry.name));
    }
  }
  return results.sort();
}

function validatePlugin(mod, filePath) {
  const errors = [];
  if (typeof mod.name !== "string" || !mod.name) errors.push("Missing or invalid 'name' (must be a non-empty string)");
  if (typeof mod.version !== "string" && typeof mod.version !== "number") errors.push("Missing or invalid 'version'");
  if (typeof mod.init !== "function") errors.push("Missing or invalid 'init' (must be a function)");
  if (typeof mod.tools !== "object" && typeof mod.tools !== "function") errors.push("Missing or invalid 'tools' (must be an object or function)");
  return errors;
}

function loadPlugin(filePath) {
  const id = path.basename(filePath, path.extname(filePath));
  try {
    delete require.cache[require.resolve(filePath)];
    const mod = require(filePath);
    const errors = validatePlugin(mod, filePath);
    if (errors.length) {
      console.error(`  [plugins] Skipping "${id}" — validation errors:\n    ${errors.join("\n    ")}`);
      return null;
    }
    const entry = {
      id,
      name: mod.name,
      version: String(mod.version),
      filePath,
      enabled: true,
      tools: typeof mod.tools === "function" ? mod.tools() : mod.tools,
      instance: mod,
      loadedAt: new Date().toISOString(),
    };
    registry.set(id, entry);
    console.log(`  [plugins] Loaded "${mod.name}" v${mod.version}`);
    return entry;
  } catch (err) {
    console.error(`  [plugins] Failed to load "${id}":`, err.message);
    return null;
  }
}

function loadAllPlugins() {
  registry.clear();
  const files = findPluginFiles();
  let loaded = 0;
  for (const file of files) {
    const entry = loadPlugin(file);
    if (entry) loaded++;
  }
  console.log(`  [plugins] Loaded ${loaded}/${files.length} plugins`);
  return loaded;
}

function initPlugins(api) {
  const results = [];
  for (const [id, entry] of registry) {
    if (!entry.enabled) {
      results.push({ id, status: "disabled" });
      continue;
    }
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

function unloadPlugin(id) {
  const entry = registry.get(id);
  if (!entry) return false;
  if (entry.instance.unload && typeof entry.instance.unload === "function") {
    try {
      entry.instance.unload();
    } catch (err) {
      console.error(`  [plugins] unload() failed for "${entry.name}":`, err.message);
    }
  }
  if (require.cache[require.resolve(entry.filePath)]) {
    delete require.cache[require.resolve(entry.filePath)];
  }
  registry.delete(id);
  return true;
}

function reloadPlugin(id, api) {
  unloadPlugin(id);
  const filePath = path.join(PLUGINS_DIR, `${id}.js`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PLUGINS_DIR, `${id}.mjs`);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`  [plugins] Cannot reload "${id}" — file not found`);
    return null;
  }
  const entry = loadPlugin(filePath);
  if (entry && entry.enabled) {
    try {
      entry.instance.init(api);
    } catch (err) {
      console.error(`  [plugins] init() after reload failed for "${entry.name}":`, err.message);
    }
  }
  return entry;
}

let watcher = null;

function startHotReload(api) {
  stopHotReload();
  if (!fs.existsSync(PLUGINS_DIR)) return;
  try {
    watcher = fs.watch(PLUGINS_DIR, (eventType, filename) => {
      if (!filename || !/\.m?js$/.test(filename)) return;
      const id = path.basename(filename, path.extname(filename));
      console.log(`  [plugins] Change detected: "${filename}"`);
      if (eventType === "rename" && !fs.existsSync(path.join(PLUGINS_DIR, filename))) {
        unloadPlugin(id);
        return;
      }
      reloadPlugin(id, api);
    });
    console.log("  [plugins] Hot-reload watching:", PLUGINS_DIR);
  } catch (err) {
    console.error("  [plugins] Failed to start hot-reload watcher:", err.message);
  }
}

function stopHotReload() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

module.exports = {
  getRegistry,
  findPluginFiles,
  validatePlugin,
  loadPlugin,
  loadAllPlugins,
  initPlugins,
  unloadPlugin,
  reloadPlugin,
  startHotReload,
  stopHotReload,
};
