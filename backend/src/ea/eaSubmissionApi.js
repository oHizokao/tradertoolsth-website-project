/* ============================================================
   EA Submission API — Phase 16
   ------------------------------------------------------------
   Public endpoint (ไม่ต้อง auth — แต่มี rate limit + CSRF/Origin):
     POST /api/ea/submissions          multipart/form-data
       fields: name, description, platform, version, strategy?,
               contactName?, contactEmail?
       files:  ea (required), cover (optional)
       → 201 { ok, id, status: "pending_review" }
       → 400 { error: "validation_failed", details: [...] }
       → 403 { error: "origin_not_allowed" }
       → 413 { error: "file_too_large" }
       → 429 { error: "rate_limited" } + retry-after header

   Admin endpoints (auth + cookie path=/api/admin):
     GET  /api/admin/ea-submissions           list pending
     GET  /api/admin/ea-submissions/:id       detail
     POST /api/admin/ea-submissions/:id/reject   reject (with notes)
     POST /api/admin/ea-submissions/:id/migrate  mark migrated (หลังโอนไป ea_products)
   ============================================================ */

import { readMultipartRequest, parseMultipartBuffer, MultipartError } from "../utils/multipart.js";
import { sanitizeEaInput } from "../content/contentValidator.js";
import { randomBytes } from "node:crypto";
import { logger } from "../utils/logger.js";

const log = logger.make("ea-submission-api");

const EA_FILE_FIELD = "ea";
const COVER_FILE_FIELD = "cover";

export function createEaSubmissionApiHandler(opts) {
  const {
    service,
    submissionRepo,
    contentRepos,
    uploadService,
    json,
    isAuthorizedAny,
    isOriginAllowed,
  } = opts;

  return async function eaSubmissionApiHandler(req, res, url, reqOpts) {
    const pathname = url.pathname;

    /* ============ PUBLIC: POST /api/ea/submissions ============ */
    if (req.method === "POST" && pathname === "/api/ea/submissions") {
      await handlePublicSubmit(req, res, url, {
        service,
        json,
        isOriginAllowed,
        reqOpts,
      });
      return true; // handled — กัน generic /api/* block จับซ้ำ
    }

    /* ============ ADMIN: /api/admin/ea-submissions/* ============ */
    if (pathname.startsWith("/api/admin/ea-submissions")) {
      await handleAdmin(req, res, url, pathname, {
        service,
        submissionRepo,
        contentRepos,
        uploadService,
        json,
        isAuthorizedAny,
        isOriginAllowed,
        reqOpts,
      });
      return true; // handled — กัน generic /api/admin/ block จับซ้ำ
    }

    return false; // ไม่ใช่ EA submission endpoint
  };
}

/* ============================================================
   PUBLIC SUBMIT
   ============================================================ */
async function handlePublicSubmit(req, res, url, ctx) {
  const { service, json, isOriginAllowed, reqOpts } = ctx;

  // 1) CSRF/Origin check (state-changing public request)
  const allowedOrigins = reqOpts?.adminAllowedOrigins || [];
  if (!isOriginAllowed(req, allowedOrigins)) {
    return json(res, 403, { error: "origin_not_allowed" });
  }

  // 2) อ่าน multipart body (limit รวม 60MB — cover 10 + EA 50)
  const MAX_BODY = 60 * 1024 * 1024;
  let parsed;
  try {
    const { buffer, boundary } = await readMultipartRequest(req, MAX_BODY);
    parsed = parseMultipartBuffer(buffer, boundary);
  } catch (err) {
    if (err instanceof MultipartError) {
      const code = err.code === "file_too_large" ? 413 : 400;
      return json(res, code, {
        error: err.code,
        message: err.message,
        ...(err.extra || {}),
      });
    }
    return json(res, 400, {
      error: "upload_parse_failed",
      message: err.message,
    });
  }

  // 3) เช็คว่ามี EA file จริง
  const eaFile = parsed.files.get(EA_FILE_FIELD);
  if (!eaFile) {
    return json(res, 400, { error: "ea_file_required" });
  }
  const coverFile = parsed.files.get(COVER_FILE_FIELD) || null;

  // 4) ดึง IP (rate limit key + audit)
  const ip = extractIp(req, Boolean(reqOpts?.trustProxy));

  // 5) เรียก service (validate + rate limit + upload + create)
  const result = await service.submitEa({
    ip,
    name: parsed.fields.name,
    description: parsed.fields.description,
    platform: parsed.fields.platform,
    version: parsed.fields.version,
    strategy: parsed.fields.strategy,
    contactName: parsed.fields.contactName,
    contactEmail: parsed.fields.contactEmail,
    coverFile: coverFile
      ? {
          buffer: coverFile.buffer,
          filename: coverFile.filename,
          size: coverFile.size,
        }
      : null,
    eaFile: {
      buffer: eaFile.buffer,
      filename: eaFile.filename,
      size: eaFile.size,
    },
  });

  // 6) map result → HTTP response
  if (!result.ok) {
    if (result.status === 429 && result.retryAfterMs) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      res.setHeader("retry-after", String(retryAfterSec));
    }
    return json(res, result.status || 400, {
      error: result.error,
      ...(result.details ? { details: result.details } : {}),
      ...(result.message ? { message: result.message } : {}),
      ...(result.extra || {}),
    });
  }

  // success — ไม่เผย IP หรือ path ภายใน
  return json(res, 201, {
    ok: true,
    id: result.id,
    slug: result.slug,
    status: result.status,
    message:
      "ส่ง EA เข้าระบบเรียบร้อย — ทีมงานจะตรวจสอบและติดต่อกลับโดยเร็ว",
  });
}

/* ============================================================
   ADMIN — auth + cookie required
   ============================================================ */
async function handleAdmin(req, res, url, pathname, ctx) {
  const {
    service,
    submissionRepo,
    contentRepos,
    uploadService,
    json,
    isAuthorizedAny,
    isOriginAllowed,
    reqOpts,
  } = ctx;

  const adminToken = reqOpts?.adminToken || "";
  const allowedOrigins = reqOpts?.adminAllowedOrigins || [];

  // auth check
  if (!adminToken) {
    return json(res, 503, { error: "admin_api_disabled" });
  }
  if (!isAuthorizedAny(req, adminToken)) {
    return json(res, 401, { error: "unauthorized" });
  }

  const rest = pathname.slice("/api/admin/ea-submissions".length);
  const parts = rest.split("/").filter(Boolean);

  // GET /api/admin/ea-submissions/counts — ต้องตรวจเส้นทางก่อน /:id
  if (req.method === "GET" && parts.length === 1 && parts[0] === "counts") {
    return json(res, 200, submissionRepo.countByStatus());
  }

  // GET /api/admin/ea-submissions — list pending (default) or by status
  if (req.method === "GET" && parts.length === 0) {
    const status = url.searchParams.get("status") || "pending_review";
    const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
    const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);
    const items =
      status === "all"
        ? submissionRepo.listAll(limit, offset)
        : submissionRepo.listByStatus(status, limit, offset);
    return json(res, 200, items);
  }

  // GET /api/admin/ea-submissions/:id — detail
  if (req.method === "GET" && parts.length === 1) {
    const id = decodeURIComponent(parts[0]);
    const item = submissionRepo.getById(id);
    if (!item) return json(res, 404, { error: "submission_not_found" });
    return json(res, 200, item);
  }

  // state-changing → CSRF/Origin
  const isStateChanging = req.method === "POST";
  if (isStateChanging && !isOriginAllowed(req, allowedOrigins)) {
    return json(res, 403, { error: "origin_not_allowed" });
  }

  // POST /api/admin/ea-submissions/:id/reject
  if (req.method === "POST" && parts.length === 2 && parts[1] === "reject") {
    const id = decodeURIComponent(parts[0]);
    const body = await readJson(req).catch(() => ({}));
    const r = service.reject(id, body.reason || body.notes || "");
    if (!r.ok) return json(res, r.status || 400, { error: r.error });
    return json(res, 200, { ok: true, id, status: "rejected" });
  }

  // POST /api/admin/ea-submissions/:id/migrate
  // โอน submission ไป ea_products (draft) + mark migrated
  if (req.method === "POST" && parts.length === 2 && parts[1] === "migrate") {
    const id = decodeURIComponent(parts[0]);
    const submission = submissionRepo.getById(id);
    if (!submission) return json(res, 404, { error: "submission_not_found" });
    if (submission.status !== "pending_review") {
      return json(res, 409, {
        error: "already_reviewed",
        status: submission.status,
      });
    }

    // สร้าง ea_products record (draft) จาก submission
    const eaRepo = contentRepos.ea;
    // sanitize ผ่าน sanitizeEaInput เพื่อ consistency
    const sanitized = sanitizeEaInput({
      name: submission.name,
      description: submission.description,
      version: submission.version,
      platform: submission.platform,
      price: 0, // public submission บังคับ free
      type: "free",
      filePath: submission.eaFilePath,
      fileName: submission.eaFileName,
      fileSize: submission.eaFileSize,
      fileMime: submission.eaFileMime,
      coverImage: submission.coverImagePath,
      status: "draft", // บังคับ draft — admin publish ทีหลัง
    });
    if (sanitized.__error) {
      return json(res, 400, {
        error: "migration_validation_failed",
        details: sanitized.__error,
      });
    }
    // slug: ใช้ slug ของ submission ถ้า unique ใน ea_products, ไม่งั้น generate
    let targetSlug = submission.slug;
    if (!targetSlug || eaRepo.slugExists(targetSlug, "")) {
      targetSlug = `${submission.slug}-${randomBytes(3).toString("hex")}`.slice(0, 120);
    }
    sanitized.slug = targetSlug;

    const createResult = eaRepo.create(sanitized);
    if (!createResult.created) {
      return json(res, 500, { error: "ea_create_failed" });
    }

    // mark submission migrated
    const body = await readJson(req).catch(() => ({}));
    const migrated = service.markMigrated(id, body.notes || `migrated to ${createResult.id}`);
    if (!migrated.ok) {
      eaRepo.remove(createResult.id);
      return json(res, migrated.status || 500, { error: migrated.error || "migration_failed" });
    }

    return json(res, 200, {
      ok: true,
      submissionId: id,
      eaProductId: createResult.id,
      eaProductStatus: "draft",
      message:
        "โอนไป EA Products แล้ว (draft) — ใช้ POST /api/admin/content/ea/" +
        createResult.id +
        "/publish เพื่อเผยแพร่",
    });
  }

  return json(res, 404, { error: "ea_submission_endpoint_not_found" });
}

/* ============================================================
   helpers
   ============================================================ */

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

async function readJson(req, maxBytes = 32768) {
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

/** extract client IP — รองรับ reverse proxy (x-forwarded-for) */
function extractIp(req, trustProxy = false) {
  const xff = trustProxy ? req.headers["x-forwarded-for"] : "";
  if (xff) {
    const first = String(xff).split(",")[0].trim();
    if (first) return first;
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}
