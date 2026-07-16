import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { toPublicNews, publicCategory } from "./publicNews.js";
import { createCalendarApiHandler } from "./calendarApi.js";
import { createMarketApiHandler } from "./marketApi.js";
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

/* ============================================================
   Phase 10 — Admin Auto Pilot auth helpers (cookie + CSRF)
   ------------------------------------------------------------
   - cookie auth: admin_session HttpOnly cookie (timing-safe)
   - CSRF/Origin: ตรวจ Origin/Referer สำหรับ state-changing requests
     (ห้ามพึ่ง SameSite cookie อย่างเดียว)
   - ไม่มี secret ใน helper เหล่านี้ (token มาจาก caller)
   ============================================================ */

const ADMIN_COOKIE_NAME = "admin_session";

/** parse Cookie header → Map<string,string> */
function parseCookies(req) {
  const out = new Map();
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out.set(k, v);
  }
  return out;
}

/** ตรวจ auth ผ่าน admin_session cookie (timing-safe compare กับ expectedToken) */
function isAuthorizedByCookie(req, expectedToken) {
  if (!expectedToken) return false;
  const cookies = parseCookies(req);
  const val = cookies.get(ADMIN_COOKIE_NAME);
  if (!val) return false;
  try {
    const a = Buffer.from(val);
    const b = Buffer.from(expectedToken);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** auth ผ่าน cookie OR Bearer (ใดอย่างถูก็ผ่าน) */
function isAuthorizedAny(req, expectedToken) {
  return isAuthorized(req, expectedToken) || isAuthorizedByCookie(req, expectedToken);
}

/**
 * ตรวจ Origin/Referer สำหรับ CSRF protection (state-changing requests)
 * - อ่าน Origin ก่อน; ถ้าไม่มี fallback ไป Referer (ตัด path เอาแค่ origin)
 * - ผ่านถ้า origin ตรงกับ host ของ req เอง หรืออยู่ใน allowlist
 * @returns {boolean}
 */
function isOriginAllowed(req, allowedOrigins = []) {
  let origin = req.headers.origin;
  if (!origin) {
    const referer = req.headers.referer || "";
    if (referer) {
      try {
        const u = new URL(referer);
        origin = `${u.protocol}//${u.host}`;
      } catch {
        origin = "";
      }
    }
  }
  if (!origin) return false; // ไม่มี Origin/Referer → บล็อก (CSRF defense)
  // allowlist ชนะ (กรณี deploy หลาย origin)
  if (Array.isArray(allowedOrigins) && allowedOrigins.length > 0) {
    return allowedOrigins.includes(origin);
  }
  // default: ต้องตรงกับ host ของ req เอง
  const host = req.headers.host;
  if (!host) return false;
  // สร้าง self origin จาก protocol + host
  // protocol detection: trust x-forwarded-proto (reverse proxy) หรือ default http
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const selfOrigin = `${proto}://${host}`;
  return origin === selfOrigin;
}

/** สร้าง Set-Cookie value สำหรับ admin_session */
function buildAdminCookie(token, { secure, maxAge = 28800 }) {
  const parts = [
    `${ADMIN_COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Path=/api/admin/auto-pilot",
    `Max-Age=${maxAge}`,
    "SameSite=Strict",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** สร้าง Set-Cookie สำหรับ clear cookie (logout) */
function buildClearAdminCookie({ secure }) {
  const parts = [`${ADMIN_COOKIE_NAME}=`, "HttpOnly", "Path=/api/admin/auto-pilot", "Max-Age=0", "SameSite=Strict"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** detect ว่า request มาผ่าน HTTPS (เพื่อตั้ง Secure flag) */
function isSecureRequest(req) {
  const proto = (req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (proto === "https") return true;
  // socket encrypted (direct TLS)
  return !!(req.socket && req.socket.encrypted);
}

// Default website = Version 2 (Gold Trading Desk)
// Version 1 ถูกนำออกจากระบบแล้ว — เหลือเฉพาะ Version 2 เท่านั้น
const SITE_DIR = "Version-2-Gold-Trading";
const SITE_HOME = `/${SITE_DIR}/home.html`;

function resolveStaticPath(pathname, projectRoot) {
  let base;
  let relative;
  if (pathname === "/") {
    // Root → redirect ไปยังหน้า Home ของ Version 2 (จัดการที่ handler)
    return { redirect: SITE_HOME };
  } else if (
    pathname === "/Version-2-Gold-Trading" ||
    pathname === "/Version-2-Gold-Trading/"
  ) {
    base = resolve(projectRoot, SITE_DIR);
    relative = "home.html";
  } else if (pathname.startsWith("/Version-2-Gold-Trading/")) {
    base = resolve(projectRoot, SITE_DIR);
    relative = pathname.slice("/Version-2-Gold-Trading/".length);
  } else if (pathname === "/v2" || pathname === "/v2/") {
    // alias สั้น → Version 2 home (ความเข้ากันได้)
    base = resolve(projectRoot, SITE_DIR);
    relative = "home.html";
  } else if (pathname.startsWith("/v2/")) {
    base = resolve(projectRoot, SITE_DIR);
    relative = pathname.slice(4);
  } else if (pathname === "/admin" || pathname === "/admin/") {
    // Phase 10 — Admin Dashboard (V2 design system)
    base = resolve(projectRoot, SITE_DIR);
    relative = "admin.html";
  } else if (pathname.startsWith("/news-assets/")) {
    base = resolve(projectRoot, "shared-assets", "news");
    relative = pathname.slice("/news-assets/".length);
  } else {
    // default fallback: ไฟล์ static ที่ root ของ Version 2
    base = resolve(projectRoot, SITE_DIR);
    relative = pathname.slice(1);
  }

  const decoded = decodeURIComponent(relative || "home.html").replace(/\\/g, "/");
  const target = resolve(base, decoded);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

async function serveStatic(req, res, options, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const resolved = resolveStaticPath(pathname, options.projectRoot);
  // root และ version-agnostic entry → ส่งต่อไปยังหน้า Home ของ Version 2
  if (resolved && resolved.redirect) {
    res.writeHead(301, {
      location: resolved.redirect,
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    res.end();
    return true;
  }
  const filePath = resolved;
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
  const { repo, updater, scheduler, autoPilot, auditRepo } = options;

  // Phase 12 — Economic Calendar handler (public + admin refresh)
  // สร้างครั้งเดียว ถ้า calendarService ถูกส่งเข้ามา
  const calendarHandler = options.calendarService
    ? createCalendarApiHandler({
        calendarService: options.calendarService,
        json,
        isAuthorizedAny,
        isOriginAllowed,
      })
    : null;

  // Phase 13 — Market Ticker handler (public, read-only)
  const marketHandler = options.marketService
    ? createMarketApiHandler({
        marketService: options.marketService,
        json,
      })
    : null;

  return async function requestHandler(req, res) {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const pathname = url.pathname;

      // ===== Phase 12 — Economic Calendar (public + admin refresh) =====
      // ต้องอยู่ก่อน /api/admin/* blocks เพื่อให้ /api/admin/calendar/refresh
      // ถูกจัดการโดย calendar handler แทนที่จะตกไป generic admin block
      if (calendarHandler) {
        const handled = calendarHandler(req, res, url, options);
        if (handled) return;
        if (handled === false && (pathname === "/api/calendar" || pathname === "/api/calendar/upcoming" || pathname === "/api/admin/calendar/refresh")) {
          return json(res, 405, { error: "method_not_allowed" });
        }
      }

      // ===== Phase 13 — Market Ticker (public, read-only) =====
      if (marketHandler) {
        const handled = await marketHandler(req, res, url);
        if (handled) return;
        if (handled === false && (pathname === "/api/market-ticker" || pathname === "/api/market-ticker/status")) {
          return json(res, 405, { error: "method_not_allowed" });
        }
      }

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

      // ===== Phase 9 + 10 — Auto Pilot admin endpoints =====
      // block นี้จัดการ auth (cookie OR Bearer) + CSRF (Origin) ของตัวเอง
      // แยกจาก /api/admin/news อื่น (ที่ใช้ Bearer เท่านั้น)
      // ห้ามเปิดเผย ADMIN_TOKEN ใน response ใดๆ
      if (pathname.startsWith("/api/admin/auto-pilot/")) {
        if (!autoPilot) {
          return json(res, 503, { error: "auto_pilot_unavailable" });
        }
        const adminToken = options.adminToken || "";
        const allowedOrigins = options.adminAllowedOrigins || [];
        const subPath = pathname.slice("/api/admin/auto-pilot/".length);
        const secure = isSecureRequest(req);

        // --- login: ไม่ต้อง auth ล่วงหน้า, ตรวจ Origin (CSRF) ---
        if (req.method === "POST" && subPath === "login") {
          if (!adminToken) return json(res, 503, { error: "admin_api_disabled" });
          if (!isOriginAllowed(req, allowedOrigins)) {
            return json(res, 403, { error: "origin_not_allowed" });
          }
          const body = await readJson(req).catch(() => ({}));
          const expected = Buffer.from(String(body.token || ""));
          const actual = Buffer.from(adminToken);
          const ok =
            expected.length === actual.length &&
            expected.length > 0 &&
            timingSafeEqual(expected, actual);
          if (!ok) {
            return json(res, 401, { error: "invalid_token" });
          }
          // ผ่าน → set HttpOnly cookie
          res.setHeader("Set-Cookie", buildAdminCookie(adminToken, { secure }));
          return json(res, 200, { ok: true, authenticated: true });
        }

        // --- session check (GET, safe method, cookie auth, ไม่ต้อง Origin) ---
        if (req.method === "GET" && subPath === "session") {
          if (!adminToken) return json(res, 503, { error: "admin_api_disabled" });
          const authenticated = isAuthorizedByCookie(req, adminToken);
          return json(res, 200, { authenticated });
        }

        // --- logout (cookie auth + Origin) ---
        if (req.method === "POST" && subPath === "logout") {
          if (!isOriginAllowed(req, allowedOrigins)) {
            return json(res, 403, { error: "origin_not_allowed" });
          }
          res.setHeader("Set-Cookie", buildClearAdminCookie({ secure }));
          return json(res, 200, { ok: true, authenticated: false });
        }

        // --- endpoints ที่เหลือ: ต้อง auth (cookie OR Bearer) ---
        // state-changing ต้อง Origin ด้วย (CSRF)
        if (!adminToken) {
          return json(res, 503, { error: "admin_api_disabled" });
        }
        if (!isAuthorizedAny(req, adminToken)) {
          return json(res, 401, { error: "unauthorized" });
        }

        // GET (safe method) — ไม่ต้อง Origin
        if (req.method === "GET" && subPath === "status") {
          const status = autoPilot.getStatus();
          const recentAudit = auditRepo ? auditRepo.recent(5) : [];
          return json(res, 200, { ...status, recentAudit });
        }

        // state-changing — ตรวจ Origin (CSRF)
        const stateChanging = ["enable", "disable", "run-once", "emergency-stop", "clear-emergency", "rollback"];
        if (req.method === "POST" && stateChanging.includes(subPath)) {
          if (!isOriginAllowed(req, allowedOrigins)) {
            return json(res, 403, { error: "origin_not_allowed" });
          }
          if (subPath === "enable") {
            const result = autoPilot.enable();
            if (!result.ok) return json(res, 409, { error: result.error });
            return json(res, 200, { ok: true, status: autoPilot.getStatus() });
          }
          if (subPath === "disable") {
            autoPilot.disable();
            return json(res, 200, { ok: true, status: autoPilot.getStatus() });
          }
          if (subPath === "emergency-stop") {
            autoPilot.emergencyStop();
            return json(res, 200, { ok: true, status: autoPilot.getStatus(), message: "รอบปัจจุบันจะหยุดก่อนข่าวถัดไป" });
          }
          if (subPath === "clear-emergency") {
            autoPilot.clearEmergencyStop();
            return json(res, 200, { ok: true, status: autoPilot.getStatus() });
          }
          if (subPath === "rollback") {
            // Rollback ข่าว published ล่าสุด → 'ready' (manual undo)
            // state-changing → ตรวจ Origin แล้วข้างต้นใน stateChanging block
            const body = await readJson(req).catch(() => ({}));
            const result = autoPilot.rollbackLatestPublished({
              reviewer: body.reviewer ? String(body.reviewer).slice(0, 80) : undefined,
            });
            if (!result.ok) {
              // no_published_news หรือ update_failed → 409
              return json(res, 409, { error: result.error });
            }
            return json(res, 200, {
              ok: true,
              ...result,
              status: autoPilot.getStatus(),
            });
          }
          if (subPath === "run-once") {
            if (autoPilot._running) {
              return json(res, 202, { ok: true, skipped: true, reason: "already_running" });
            }
            if (!autoPilot.getStatus().enabled) {
              return json(res, 409, { error: "auto_pilot_disabled" });
            }
            const body = await readJson(req).catch(() => ({}));
            autoPilot
              .runOnce({
                maxPerRun: clampInt(body.maxPerRun, 3, 1, 3),
                aiOpts: body.aiOpts,
                skipImage: body.skipImage,
              })
              .catch((err) => console.error(`[auto-pilot] run-once failed: ${err.message}`));
            return json(res, 202, { ok: true, message: "run-once started", running: true });
          }
        }

        return json(res, 404, { error: "auto_pilot_endpoint_not_found" });
      }

      if (pathname.startsWith("/api/admin/")) {
        if (!options.adminToken) {
          return json(res, 503, { error: "admin_api_disabled" });
        }
        // Auth: cookie (admin_session) OR Bearer — ขยายจาก Bearer-only เพื่อให้
        // News Management UI ที่ login ผ่าน /api/admin/auto-pilot/login ใช้ session เดียวกันได้
        const adminToken = options.adminToken || "";
        const allowedOrigins = options.adminAllowedOrigins || [];
        if (!isAuthorizedAny(req, adminToken)) {
          return json(res, 401, { error: "unauthorized" });
        }
        // CSRF/Origin check สำหรับ state-changing methods (POST/PUT/DELETE/PATCH)
        // GET/HEAD ผ่านได้โดยไม่ต้องตรวจ Origin (เหมือน pattern auto-pilot)
        const isStateChanging =
          req.method === "POST" || req.method === "PUT" || req.method === "DELETE" || req.method === "PATCH";
        if (isStateChanging && !isOriginAllowed(req, allowedOrigins)) {
          return json(res, 403, { error: "origin_not_allowed" });
        }
        if (req.method === "GET" && pathname === "/api/admin/news/counts") {
          // stats สำหรับ Admin Dashboard: แยกตาม publish_status + validation_status
          return json(res, 200, {
            publishStatus: repo.countByPublishStatus(),
            validationStatus: repo.countByStatus(),
            total: repo.countAll(),
          });
        }
        if (req.method === "GET" && pathname === "/api/admin/news") {
          const limit = clampInt(url.searchParams.get("limit"), 100, 1, 200);
          const statusFilter = url.searchParams.get("status"); // filter ตาม publish_status
          const source = statusFilter
            ? repo.listByPublishStatus(statusFilter, limit)
            : repo.listAll(limit, 0);
          const rows = source.map((item) => ({
            id: item.id,
            title: item.thaiTitle || item.originalTitle,
            validationStatus: item.validationStatus,
            publishStatus: item.publishStatus,
            aiConfidence: item.aiConfidence,
            imageStatus: item.imageStatus,
            imageReviewRequired: item.imageReviewRequired,
            sourceUrl: item.sourceUrl,
            sourceName: item.source,
            sourcePublishedAt: item.sourcePublishedAt,
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
