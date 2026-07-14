import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { toPublicNews, publicCategory } from "./publicNews.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function isAuthorized(req, token) {
  if (!token) return false;
  return req.headers.authorization === `Bearer ${token}`;
}

function resolveStaticPath(pathname, projectRoot, siteVersion) {
  let base;
  let relative;
  if (pathname === "/") {
    base = projectRoot;
    relative = "index.html";
  } else if (pathname === "/v1" || pathname === "/v1/") {
    base = resolve(projectRoot, "Version-1-Premium-Dashboard");
    relative = "home.html";
  } else if (pathname.startsWith("/v1/")) {
    base = resolve(projectRoot, "Version-1-Premium-Dashboard");
    relative = pathname.slice(4);
  } else if (pathname === "/v2" || pathname === "/v2/") {
    base = resolve(projectRoot, "Version-2-Gold-Trading");
    relative = "home.html";
  } else if (pathname.startsWith("/v2/")) {
    base = resolve(projectRoot, "Version-2-Gold-Trading");
    relative = pathname.slice(4);
  } else {
    base = resolve(
      projectRoot,
      siteVersion === "1"
        ? "Version-1-Premium-Dashboard"
        : "Version-2-Gold-Trading"
    );
    relative = pathname.slice(1);
  }

  const decoded = decodeURIComponent(relative || "home.html").replace(/\\/g, "/");
  const target = resolve(base, decoded);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

async function serveStatic(req, res, options, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const filePath = resolveStaticPath(pathname, options.projectRoot, options.siteVersion);
  if (!filePath) return false;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "content-length": data.length,
      "cache-control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=300",
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : data);
    return true;
  } catch {
    return false;
  }
}

export function createRequestHandler(options) {
  const { repo, updater, scheduler } = options;
  return async function requestHandler(req, res) {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const pathname = url.pathname;

      if (req.method === "GET" && pathname === "/api/health") {
        return json(res, 200, {
          ok: true,
          service: "tradertoolsth-news",
          publishedNews: repo.countPublished(),
          scheduler: scheduler?.status?.() || { enabled: false },
        });
      }

      if (req.method === "GET" && pathname === "/api/news") {
        const category = url.searchParams.get("category") || "all";
        const limit = clampInt(url.searchParams.get("limit"), 50, 1, 100);
        const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10000);
        const all = repo.listPublished(500, 0);
        const filtered = category === "all"
          ? all
          : all.filter((item) => publicCategory(item) === category);
        return json(res, 200, filtered.slice(offset, offset + limit).map(toPublicNews));
      }

      if (req.method === "GET" && pathname.startsWith("/api/news/")) {
        const id = decodeURIComponent(pathname.slice("/api/news/".length));
        const item = repo.getPublishedById(id);
        if (!item) return json(res, 404, { error: "news_not_found" });
        return json(res, 200, toPublicNews(item));
      }

      if (pathname.startsWith("/api/admin/")) {
        if (!options.adminToken) {
          return json(res, 503, { error: "admin_api_disabled" });
        }
        if (!isAuthorized(req, options.adminToken)) {
          return json(res, 401, { error: "unauthorized" });
        }
        if (req.method === "GET" && pathname === "/api/admin/news") {
          const limit = clampInt(url.searchParams.get("limit"), 100, 1, 200);
          const rows = repo.listAll(limit, 0).map((item) => ({
            id: item.id,
            title: item.thaiTitle || item.originalTitle,
            validationStatus: item.validationStatus,
            publishStatus: item.publishStatus,
            aiConfidence: item.aiConfidence,
            imageStatus: item.imageStatus,
            imageReviewRequired: item.imageReviewRequired,
            sourceUrl: item.sourceUrl,
            createdAt: item.createdAt,
          }));
          return json(res, 200, rows);
        }
        if (req.method === "POST" && pathname === "/api/admin/run") {
          if (!updater) return json(res, 503, { error: "updater_unavailable" });
          const result = await updater.run();
          return json(res, result.skipped ? 202 : 200, result);
        }
      }

      if (pathname.startsWith("/api/")) {
        return json(res, 404, { error: "api_not_found" });
      }

      if (await serveStatic(req, res, options, pathname)) return;
      return json(res, 404, { error: "not_found" });
    } catch (error) {
      return json(res, 500, { error: "internal_error", message: error.message });
    }
  };
}

export function createHttpServer(options) {
  return createServer(createRequestHandler(options));
}

export async function listen(server, { host, port }) {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolveListen);
  });
  return server.address();
}
