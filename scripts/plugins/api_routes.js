const { listPlugins, enablePlugin, disablePlugin, installPlugin, uninstallPlugin } = require("./plugin_manager");

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    const limit = maxBytes || 64 * 1024 * 1024;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        req.destroy(new Error("Request body too large"));
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

function registerPluginRoutes(server) {
  const originalListen = server.listen.bind(server);
  const routes = [];

  routes.push({ method: "GET", url: "/api/plugins", handler: async (req, res) => {
    return json(res, 200, { ok: true, plugins: listPlugins() });
  }});

  routes.push({ method: "POST", url: "/api/plugins/install", handler: async (req, res) => {
    try {
      const body = await readJsonBody(req);
      if (!body.url || typeof body.url !== "string") {
        return json(res, 400, { ok: false, error: "Missing 'url' in request body" });
      }
      const result = await installPlugin(body.url);
      return json(res, 201, result);
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }});

  routes.push({ method: "POST", url: "/api/plugins/:id/toggle", handler: async (req, res, params) => {
    const id = params.id;
    const body = await readJsonBody(req);
    const enable = body.enable !== false;
    const result = enable ? enablePlugin(id) : disablePlugin(id);
    return json(res, result.ok ? 200 : 404, result);
  }});

  routes.push({ method: "DELETE", url: "/api/plugins/:id", handler: async (req, res, params) => {
    const result = uninstallPlugin(params.id);
    return json(res, result.ok ? 200 : 404, result);
  }});

  server.listen = function (...args) {
    const handler = server.listeners("request")[0] || ((req, res) => {
      res.writeHead(404);
      res.end("Not found");
    });

    server.removeAllListeners("request");

    server.on("request", async (req, res) => {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,DELETE" });
        res.end();
        return;
      }

      let matched = false;
      for (const route of routes) {
        const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        let pathname = urlObj.pathname;

        if (route.url.includes(":")) {
          const pattern = new RegExp("^" + route.url.replace(/:([^/]+)/g, "(?<$1>[^/]+)") + "$");
          const m = pathname.match(pattern);
          if (m && req.method === route.method) {
            matched = true;
            const params = m.groups || {};
            await route.handler(req, res, params);
            break;
          }
        } else {
          if (pathname === route.url && req.method === route.method) {
            matched = true;
            await route.handler(req, res);
            break;
          }
        }
      }

      if (!matched) {
        handler(req, res);
      }
    });

    return originalListen(...args);
  };

  return server;
}

async function handlePluginRequest(req, res) {
  const url = req.url;
  const method = req.method;

  if (url === "/api/plugins" && method === "GET") {
    return json(res, 200, { ok: true, plugins: listPlugins() });
  }

  if (url === "/api/plugins/install" && method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!body.url || typeof body.url !== "string") {
        return json(res, 400, { ok: false, error: "Missing 'url' in request body" });
      }
      const result = await installPlugin(body.url);
      return json(res, 201, result);
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  const toggleMatch = url.match(/^\/api\/plugins\/([^/]+)\/toggle$/);
  if (toggleMatch && method === "POST") {
    const id = toggleMatch[1];
    const body = await readJsonBody(req);
    const enable = body.enabled !== false;
    const result = enable ? enablePlugin(id) : disablePlugin(id);
    return json(res, result.ok ? 200 : 404, result);
  }

  const deleteMatch = url.match(/^\/api\/plugins\/([^/]+)$/);
  if (deleteMatch && method === "DELETE") {
    const result = uninstallPlugin(deleteMatch[1]);
    return json(res, result.ok ? 200 : 404, result);
  }

  return false;
}

module.exports = { registerPluginRoutes, handlePluginRequest };
