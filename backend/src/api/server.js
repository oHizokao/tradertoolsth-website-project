import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { toPublicNews, publicCategory } from "./publicNews.js";
import { isReadyForAutoPublish } from "../pipeline/runNewsUpdate.js";
import { validateRewritten } from "../ai/validator.js";
import { makeOwnedPlaceholder } from "../image/imagePipeline.js";

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
  const actual = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJson(req, maxBytes = 32_768) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function resolveStaticPath(pathname, projectRoot, siteVersion) {
  let base;
  let relative;
  if (pathname === "/") {
    base = projectRoot;
    relative = "index.html";
  } else if (
    pathname === "/Version-1-Premium-Dashboard" ||
    pathname === "/Version-1-Premium-Dashboard/"
  ) {
    base = resolve(projectRoot, "Version-1-Premium-Dashboard");
    relative = "home.html";
  } else if (pathname.startsWith("/Version-1-Premium-Dashboard/")) {
    base = resolve(projectRoot, "Version-1-Premium-Dashboard");
    relative = pathname.slice("/Version-1-Premium-Dashboard/".length);
  } else if (
    pathname === "/Version-2-Gold-Trading" ||
    pathname === "/Version-2-Gold-Trading/"
  ) {
    base = resolve(projectRoot, "Version-2-Gold-Trading");
    relative = "home.html";
  } else if (pathname.startsWith("/Version-2-Gold-Trading/")) {
    base = resolve(projectRoot, "Version-2-Gold-Trading");
    relative = pathname.slice("/Version-2-Gold-Trading/".length);
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
  } else if (pathname.startsWith("/news-assets/")) {
    base = resolve(projectRoot, "shared-assets", "news");
    relative = pathname.slice("/news-assets/".length);
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
        // category เป็น derived field (gold/forex จาก keyword) → filter ใน JS ทั้งหมด
        // แล้วค่อย apply limit/offset เพื่อให้ pagination ถูกต้อง
        const category = url.searchParams.get("category") || "all";
        // ค่าเริ่มต้น limit=50 (ก่อนหน้านี้เป็น 50 เช่นกัน) สูงสุด 50 ป้องกันดึงมากเกินไป
        const limit = clampInt(url.searchParams.get("limit"), 50, 1, 50);
        const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);
        // ดึงข่าว published ทั้งหมด (เรียงใหม่→เก่า, validated เท่านั้น)
        const all = repo.listAllPublished();
        const filtered = category === "all"
          ? all
          : all.filter((item) => publicCategory(item) === category);
        const total = filtered.length;
        const page = filtered.slice(offset, offset + limit).map(toPublicNews);
        const hasMore = offset + page.length < total;

        // รองรับ client เก่าที่คาดหวัง plain array เดิม: ?format=array
        // ค่าเริ่มต้น (ไม่ส่ง format) = envelope {items,total,limit,offset,hasMore}
        const asArray = url.searchParams.get("format") === "array";
        if (asArray) return json(res, 200, page);
        return json(res, 200, {
          items: page,
          total,
          limit,
          offset,
          hasMore,
        });
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
        if (req.method === "GET" && pathname.startsWith("/api/admin/news/")) {
          const id = decodeURIComponent(pathname.slice("/api/admin/news/".length));
          const item = repo.getById(id);
          if (!item) return json(res, 404, { error: "news_not_found" });
          return json(res, 200, item);
        }
        const reviewMatch = pathname.match(/^\/api\/admin\/news\/([^/]+)\/review$/);
        if (req.method === "POST" && reviewMatch) {
          const id = decodeURIComponent(reviewMatch[1]);
          const item = repo.getById(id);
          if (!item) return json(res, 404, { error: "news_not_found" });
          const body = await readJson(req);
          if (body.sourceChecked !== true || !body.reviewer) {
            return json(res, 400, { error: "source_check_and_reviewer_required" });
          }
          const reviewed = body.news;
          if (!reviewed?.thaiTitle || !Array.isArray(reviewed.thaiContent) || !reviewed.thaiContent.length) {
            return json(res, 400, { error: "reviewed_news_schema_invalid" });
          }
          const localCheck = validateRewritten(item, reviewed);
          if (!localCheck.canAutoValidate) {
            return json(res, 409, { error: "deterministic_quality_gate", localCheck });
          }
          const image = makeOwnedPlaceholder({ ...item, ...reviewed }, reviewed.imageSearchKeywords || []);
          repo.saveManualReview(id, reviewed, localCheck, image, {
            reviewer: String(body.reviewer).slice(0, 80),
            notes: String(body.notes || "").slice(0, 500),
          });
          return json(res, 200, { ok: true, id, validationStatus: "validated", publishStatus: "ready", localCheck });
        }
        if (req.method === "POST" && pathname === "/api/admin/run") {
          if (!updater) return json(res, 503, { error: "updater_unavailable" });
          const body = await readJson(req);
          const result = await updater.run({
            maxPerRun: clampInt(body.maxPerRun, 3, 1, 10),
            autoPublish: false,
          });
          return json(res, result.skipped ? 202 : 200, result);
        }
        const actionMatch = pathname.match(/^\/api\/admin\/news\/([^/]+)\/(approve|reject|publish)$/);
        if (req.method === "POST" && actionMatch) {
          const id = decodeURIComponent(actionMatch[1]);
          const action = actionMatch[2];
          const item = repo.getById(id);
          if (!item) return json(res, 404, { error: "news_not_found" });
          if (action === "reject") {
            const body = await readJson(req);
            repo.updateValidationStatus(id, "rejected", `manual_reject:${String(body.reason || "ไม่ผ่านการตรวจ").slice(0, 300)}`);
            repo.updatePublishStatus(id, "rejected");
            return json(res, 200, { ok: true, id, validationStatus: "rejected", publishStatus: "rejected" });
          }
          if (action === "approve") {
            if (item.validationStatus !== "validated") {
              return json(res, 409, { error: "quality_validation_required", validationStatus: item.validationStatus });
            }
            repo.updatePublishStatus(id, "ready");
            return json(res, 200, { ok: true, id, publishStatus: "ready" });
          }
          if (!isReadyForAutoPublish(item)) {
            return json(res, 409, { error: "publish_guard_rejected" });
          }
          const published = repo.updatePublishStatus(id, "published");
          return json(res, published ? 200 : 409, published
            ? { ok: true, id, publishStatus: "published" }
            : { error: "publish_update_rejected" });
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
