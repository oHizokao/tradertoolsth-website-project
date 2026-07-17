/* ============================================================
   Content API — Admin CRUD + publish gate + Public read
   ------------------------------------------------------------
   Admin endpoints (auth + CSRF/Origin required):
     GET    /api/admin/content/{type}                     list (all statuses)
     GET    /api/admin/content/{type}/:id                 detail
     POST   /api/admin/content/{type}                     create
     PUT    /api/admin/content/{type}/:id                 update
     DELETE /api/admin/content/{type}/:id                 delete
     POST   /api/admin/content/{type}/:id/publish         publish (gate)
     POST   /api/admin/content/{type}/:id/unpublish       unpublish
     POST   /api/admin/content/upload/ea                  upload EA file
     POST   /api/admin/content/upload/image               upload cover image
     GET    /api/admin/content/counts                     stats per type

   Public endpoints (no auth — published only):
     GET    /api/content/{type}                            list published
     GET    /api/content/{type}/:slug                      detail by slug

   type: 'ea' | 'articles' | 'faq' | 'brokers'

   กฎ QC:
   - ทุก admin endpoint ใช้ isAuthorizedAny + isOriginAllowed (state-changing)
   - public response มี envelope + ตัด internal fields
   - ห้ามเผย secret/token ใดๆ
   - ใช้ prepared statements (ผ่าน repository) ทุก query
   - upload ปฏิเสธ unsafe files (extension/size/magic bytes/path traversal)
   ============================================================ */

import { Readable } from "node:stream";
import { UploadError } from "../content/uploadService.js";
import {
  sanitizeEaInput,
  sanitizeArticleInput,
  sanitizeFaqInput,
  sanitizeBrokerInput,
  sanitizeSlug,
  isValidSlug,
} from "../content/contentValidator.js";

const VALID_TYPES = ["ea", "articles", "faq", "brokers"];

/** map type → repository key + sanitizer + id-prefix + slug-required */
const TYPE_CONFIG = {
  ea: {
    repoKey: "ea",
    sanitizer: sanitizeEaInput,
    hasSlug: true,
    publicFields: [
      "id",
      "slug",
      "name",
      "description",
      "version",
      "platform",
      "price",
      "type",
      "filePath",
      "coverImage",
      "sortOrder",
      "publishedAt",
    ],
  },
  articles: {
    repoKey: "article",
    sanitizer: sanitizeArticleInput,
    hasSlug: true,
    publicFields: [
      "id",
      "slug",
      "title",
      "excerpt",
      "body",
      "category",
      "readMinutes",
      "coverImage",
      "sortOrder",
      "publishedAt",
    ],
  },
  faq: {
    repoKey: "faq",
    sanitizer: sanitizeFaqInput,
    hasSlug: false,
    publicFields: [
      "id",
      "question",
      "answer",
      "category",
      "sortOrder",
      "publishedAt",
    ],
  },
  brokers: {
    repoKey: "broker",
    sanitizer: sanitizeBrokerInput,
    hasSlug: true,
    publicFields: [
      "id",
      "slug",
      "name",
      "shortName",
      "overview",
      "rating",
      "score",
      "logoColor",
      "license",
      "regulation",
      "spread",
      "commission",
      "depositWithdraw",
      "platform",
      "minDeposit",
      "pros",
      "cons",
      "suitableFor",
      "affiliateDisclosure",
      "referenceUrl",
      "coverImage",
      "reviewedAt",
      "sortOrder",
      "publishedAt",
    ],
  },
};

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** อ่าน JSON body (มี limit ขนาด) */
async function readJson(req, maxBytes = 1024 * 1024) {
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

/** แปลง repo object → public object (เลือก field + camelCase) */
function toPublic(obj, fields) {
  if (!obj) return null;
  const out = {};
  for (const f of fields) {
    if (f in obj) out[f] = obj[f];
  }
  return out;
}

/** parse multipart/form-data แบบง่าย — return { fields, file } */
async function readMultipart(req, maxBytes) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) {
    throw new UploadError("invalid_content_type", "ต้องเป็น multipart/form-data");
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  // อ่านทั้ง body ไป buffer (เช็คขนาดรวม)
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes + 1024) {
      throw new UploadError("file_too_large", `request body ใหญ่เกิน ${maxBytes}`);
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  return parseMultipartBuffer(buffer, boundary);
}

/** parse multipart buffer เป็น parts (RFC 2388 แบบง่าย) */
function parseMultipartBuffer(buffer, boundary) {
  const fields = {};
  let file = null;
  const delim = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(buffer, delim);

  for (const part of parts) {
    if (part.length === 0) continue;
    // ข้าม closing boundary (--boundary--)
    if (part.length <= 4 && part.toString("utf8").includes("--")) continue;

    // แยก header / body ด้วย \r\n\r\n
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString("utf8");
    const bodyBuf = part.slice(headerEnd + 4);
    // ตัด trailing \r\n
    const trimmedBody =
      bodyBuf.length >= 2 && bodyBuf[bodyBuf.length - 2] === 0x0d && bodyBuf[bodyBuf.length - 1] === 0x0a
        ? bodyBuf.slice(0, -2)
        : bodyBuf;

    // parse Content-Disposition
    const nameMatch = /name="([^"]+)"/i.exec(headerStr);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    const filenameMatch = /filename="([^"]*)"/i.exec(headerStr);
    const ctMatch = /content-type:\s*([^\r\n]+)/i.exec(headerStr);

    if (filenameMatch) {
      file = {
        fieldName,
        filename: filenameMatch[1],
        contentType: ctMatch ? ctMatch[1].trim() : "application/octet-stream",
        buffer: trimmedBody,
        size: trimmedBody.length,
      };
    } else {
      fields[fieldName] = trimmedBody.toString("utf8");
    }
  }
  return { fields, file };
}

/** split buffer ด้วย delimiter (return ส่วนที่อยู่ระหว่าง delimiter) */
function splitBuffer(buf, delim) {
  const parts = [];
  let start = 0;
  let idx;
  while ((idx = buf.indexOf(delim, start)) !== -1) {
    if (start > 0) {
      // เอาส่วนหลัง delimiter ก่อนหน้านี้ (ข้าม \r\n นำหน้า)
      let chunkStart = start;
      // ตัด \r\n นำหน้า (RFC: parts คั่นด้วย \r\n--boundary)
      if (chunkStart >= 2 && buf[chunkStart] === 0x0d && buf[chunkStart + 1] === 0x0a) {
        chunkStart += 2;
      }
      parts.push(buf.slice(chunkStart, idx));
    }
    start = idx + delim.length;
  }
  // part สุดท้าย
  if (start < buf.length) {
    let chunkStart = start;
    if (chunkStart >= 2 && buf[chunkStart] === 0x0d && buf[chunkStart + 1] === 0x0a) {
      chunkStart += 2;
    }
    parts.push(buf.slice(chunkStart));
  }
  return parts;
}

/**
 * สร้าง handler สำหรับ content API
 * @param {object} opts { repos, uploadService, json, isAuthorizedAny, isOriginAllowed, adminToken, adminAllowedOrigins, uploadsRoot }
 * @returns {(req, res, url, reqOpts) => boolean|Promise<boolean>}
 */
export function createContentApiHandler(opts) {
  const {
    repos,
    uploadService,
    json,
    isAuthorizedAny,
    isOriginAllowed,
  } = opts;

  return async function contentApiHandler(req, res, url, reqOpts) {
    const pathname = url.pathname;

    /* ============ PUBLIC: /api/content/{type} ============ */
    if (req.method === "GET" && pathname.startsWith("/api/content/")) {
      return handlePublicContent(req, res, url, pathname, repos, json);
    }

    /* ============ ADMIN: /api/admin/content/* ============ */
    if (pathname.startsWith("/api/admin/content/")) {
      return handleAdminContent(req, res, url, pathname, {
        repos,
        uploadService,
        json,
        isAuthorizedAny,
        isOriginAllowed,
        reqOpts,
      });
    }

    return false; // ไม่ใช่ content endpoint
  };
}

/* ============================================================
   PUBLIC handler — published only
   ============================================================ */
function handlePublicContent(req, res, url, pathname, repos, json) {
  // /api/content/{type} หรือ /api/content/{type}/:slug
  const rest = pathname.slice("/api/content/".length);
  const parts = rest.split("/").filter(Boolean);

  if (parts.length === 0) return false;

  const type = parts[0];
  if (!VALID_TYPES.includes(type)) {
    json(res, 404, { error: "content_type_not_found" });
    return true;
  }

  const cfg = TYPE_CONFIG[type];
  const repo = repos[cfg.repoKey];

  // /api/content/{type}/:slug → detail
  if (parts.length >= 2) {
    const slugOrId = decodeURIComponent(parts[1]);
    let item = null;
    // ลองด้วย slug ก่อน (ถ้า type มี slug) ไม่งั้นลอง id
    if (cfg.hasSlug && isValidSlug(slugOrId)) {
      item = repo.getPublishedBySlug(slugOrId);
    }
    if (!item) {
      item = repo.getPublishedById(slugOrId);
    }
    if (!item) {
      json(res, 404, { error: "content_not_found" });
      return true;
    }
    json(res, 200, toPublic(item, cfg.publicFields));
    return true;
  }

  // /api/content/{type} → list published
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);
  const category = url.searchParams.get("category") || null;

  let items = repo.listPublished(limit, offset);
  // filter category ใน JS (category เป็น derived field ได้)
  if (category) {
    items = items.filter((it) => String(it.category || "").toLowerCase() === category.toLowerCase());
  }

  const payload = {
    items: items.map((it) => toPublic(it, cfg.publicFields)),
    total: items.length,
    limit,
    offset,
  };
  json(res, 200, payload);
  return true;
}

/* ============================================================
   ADMIN handler — auth + CSRF required
   ============================================================ */
async function handleAdminContent(req, res, url, pathname, ctx) {
  const { repos, uploadService, json, isAuthorizedAny, isOriginAllowed, reqOpts } = ctx;
  const adminToken = reqOpts.adminToken || "";
  const allowedOrigins = reqOpts.adminAllowedOrigins || [];

  // ---- auth check ----
  if (!adminToken) {
    json(res, 503, { error: "admin_api_disabled" });
    return true;
  }
  if (!isAuthorizedAny(req, adminToken)) {
    json(res, 401, { error: "unauthorized" });
    return true;
  }

  // ---- CSRF/Origin check สำหรับ state-changing methods ----
  const isStateChanging =
    req.method === "POST" || req.method === "PUT" || req.method === "DELETE" || req.method === "PATCH";
  if (isStateChanging && !isOriginAllowed(req, allowedOrigins)) {
    json(res, 403, { error: "origin_not_allowed" });
    return true;
  }

  const rest = pathname.slice("/api/admin/content/".length);
  const parts = rest.split("/").filter(Boolean);

  // ---- /api/admin/content/counts ----
  if (req.method === "GET" && parts[0] === "counts") {
    const out = {};
    for (const [type, cfg] of Object.entries(TYPE_CONFIG)) {
      const repo = repos[cfg.repoKey];
      out[type] = {
        total: repo.countAll(),
        byStatus: repo.countByStatus(),
      };
    }
    json(res, 200, out);
    return true;
  }

  // ---- /api/admin/content/upload/ea ----
  // ---- /api/admin/content/upload/image ----
  if (req.method === "POST" && parts[0] === "upload" && (parts[1] === "ea" || parts[1] === "image")) {
    return handleUpload(req, res, parts[1], uploadService, json);
  }

  // ---- /api/admin/content/{type}... ----
  if (parts.length === 0) {
    json(res, 404, { error: "content_type_not_found" });
    return true;
  }

  const type = parts[0];
  if (!VALID_TYPES.includes(type)) {
    json(res, 404, { error: "content_type_not_found" });
    return true;
  }

  const cfg = TYPE_CONFIG[type];
  const repo = repos[cfg.repoKey];

  // ---- LIST: GET /api/admin/content/{type} ----
  if (req.method === "GET" && parts.length === 1) {
    const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
    const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);
    const status = url.searchParams.get("status") || null;
    const items = status ? repo.listByStatus(status, limit, offset) : repo.listAll(limit, offset);
    json(res, 200, items);
    return true;
  }

  // ---- DETAIL: GET /api/admin/content/{type}/:id ----
  if (req.method === "GET" && parts.length === 2) {
    const id = decodeURIComponent(parts[1]);
    const item = repo.getById(id);
    if (!item) {
      json(res, 404, { error: "content_not_found" });
      return true;
    }
    json(res, 200, item);
    return true;
  }

  // ---- CREATE: POST /api/admin/content/{type} ----
  if (req.method === "POST" && parts.length === 1) {
    return handleCreate(req, res, type, cfg, repo, json);
  }

  // ---- UPDATE: PUT /api/admin/content/{type}/:id ----
  if (req.method === "PUT" && parts.length === 2) {
    const id = decodeURIComponent(parts[1]);
    return handleUpdate(req, res, id, type, cfg, repo, json);
  }

  // ---- DELETE: DELETE /api/admin/content/{type}/:id ----
  if (req.method === "DELETE" && parts.length === 2) {
    const id = decodeURIComponent(parts[1]);
    const result = repo.remove(id);
    if (!result.deleted) {
      json(res, 404, { error: "content_not_found" });
      return true;
    }
    json(res, 200, { ok: true, id, deleted: true });
    return true;
  }

  // ---- PUBLISH: POST /api/admin/content/{type}/:id/publish ----
  if (req.method === "POST" && parts.length === 3 && parts[2] === "publish") {
    const id = decodeURIComponent(parts[1]);
    const result = repo.publish(id);
    if (!result.published) {
      const code = result.error === "not_found" ? 404 : 409;
      json(res, code, { error: result.error, missing: result.missing });
      return true;
    }
    json(res, 200, { ok: true, id, published: true });
    return true;
  }

  // ---- UNPUBLISH: POST /api/admin/content/{type}/:id/unpublish ----
  if (req.method === "POST" && parts.length === 3 && parts[2] === "unpublish") {
    const id = decodeURIComponent(parts[1]);
    const result = repo.unpublish(id);
    if (!result.unpublished) {
      const code = result.error === "not_found" ? 404 : 409;
      json(res, code, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true, id, unpublished: true });
    return true;
  }

  json(res, 404, { error: "content_endpoint_not_found" });
  return true;
}

/* ============================================================
   CREATE handler
   ============================================================ */
async function handleCreate(req, res, type, cfg, repo, json) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    json(res, 400, { error: "invalid_json" });
    return true;
  }
  const sanitized = cfg.sanitizer(body);
  if (sanitized.__error) {
    json(res, 400, { error: "validation_failed", details: sanitized.__error });
    return true;
  }
  // slug: ถ้า type มี slug และไม่ได้ส่งมา → generate จาก name/title
  if (cfg.hasSlug && !sanitized.slug) {
    const base = sanitized.name || sanitized.title || "item";
    sanitized.slug = sanitizeSlug(base);
    if (!isValidSlug(sanitized.slug)) {
      json(res, 400, { error: "slug_required", details: "cannot_generate_slug" });
      return true;
    }
  }
  // slug uniqueness check
  if (cfg.hasSlug && sanitized.slug && repo.slugExists(sanitized.slug, "")) {
    json(res, 409, { error: "slug_already_exists" });
    return true;
  }
  const result = repo.create(sanitized);
  if (!result.created) {
    json(res, 500, { error: "create_failed" });
    return true;
  }
  const item = repo.getById(result.id);
  json(res, 201, item);
  return true;
}

/* ============================================================
   UPDATE handler
   ============================================================ */
async function handleUpdate(req, res, id, type, cfg, repo, json) {
  const existing = repo.getById(id);
  if (!existing) {
    json(res, 404, { error: "content_not_found" });
    return true;
  }
  let body;
  try {
    body = await readJson(req);
  } catch {
    json(res, 400, { error: "invalid_json" });
    return true;
  }
  const sanitized = cfg.sanitizer(body);
  if (sanitized.__error) {
    json(res, 400, { error: "validation_failed", details: sanitized.__error });
    return true;
  }
  // slug uniqueness check (ถ้าเปลี่ยน slug)
  if (cfg.hasSlug && sanitized.slug && repo.slugExists(sanitized.slug, id)) {
    json(res, 409, { error: "slug_already_exists" });
    return true;
  }
  const result = repo.update(id, sanitized);
  if (!result.updated) {
    json(res, 500, { error: "update_failed" });
    return true;
  }
  const item = repo.getById(id);
  json(res, 200, item);
  return true;
}

/* ============================================================
   UPLOAD handler (multipart/form-data)
   ============================================================ */
async function handleUpload(req, res, kind, uploadService, json) {
  const maxBytes =
    kind === "ea" ? uploadService.EA_MAX_BYTES : uploadService.IMAGE_MAX_BYTES;
  // header limit + body buffer limit
  const contentLength = Number.parseInt(req.headers["content-length"] || "0", 10);
  if (contentLength > maxBytes + 4096) {
    json(res, 413, { error: "file_too_large", maxSize: maxBytes });
    return true;
  }

  let parsed;
  try {
    parsed = await readMultipart(req, maxBytes);
  } catch (err) {
    if (err instanceof UploadError) {
      const code = err.code === "file_too_large" ? 413 : 400;
      json(res, code, { error: err.code, message: err.message, extra: err.extra });
      return true;
    }
    json(res, 400, { error: "upload_parse_failed", message: err.message });
    return true;
  }

  if (!parsed.file) {
    json(res, 400, { error: "no_file_provided" });
    return true;
  }

  const uploadFn = kind === "ea" ? uploadService.uploadEa : uploadService.uploadImage;

  try {
    const result = await uploadFn({
      source: Readable.from([parsed.file.buffer]),
      filename: parsed.file.filename,
      declaredSize: parsed.file.size,
    });
    json(res, 201, {
      ok: true,
      path: result.path,
      filename: result.filename,
      size: result.size,
      mime: result.mime,
      ext: result.ext,
    });
    return true;
  } catch (err) {
    if (err instanceof UploadError) {
      const code = err.code === "file_too_large" ? 413 : 400;
      json(res, code, { error: err.code, message: err.message, extra: err.extra });
      return true;
    }
    json(res, 500, { error: "upload_failed", message: err.message });
    return true;
  }
}

export { VALID_TYPES };
