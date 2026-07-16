/* ============================================================
   EA Submission Service — Phase 16
   ------------------------------------------------------------
   จัดการ public submission flow:
   1. validate metadata (name, description, platform, version, email)
   2. rate limit (IP-based)
   3. upload cover image (optional) + EA file (required) via uploadService
   4. create submission row (status=buk'd pending_review โดย repo)
   5. ห้าม publish อัตโนมัติ — admin เป็นผู้ approve/reject เท่านั้น

   กฎ QC:
   - ไม่รับ status/published/price/downloadUrl จาก client เด็ดขาด
   - บังคับ price=0 concept (submission ไม่มี price ใน DB)
   - platform ∈ {mt4, mt5, both}
   - rate limit key = IP (sanitize กัน header injection)
   ============================================================ */

import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { UploadError } from "../content/uploadService.js";
import { logger } from "../utils/logger.js";

const log = logger.make("ea-submission-service");

const VALID_PLATFORMS = Object.freeze(["mt4", "mt5", "both"]);

/** slug ต้องเป็น [a-z0-9-] ติดกัน (กัน path traversal/injection) */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sanitizeSlug(input, maxLen = 120) {
  if (!input) return "";
  const s = String(input)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen);
  return s;
}

function isValidEmail(email) {
  if (!email) return true; // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
}

export function createEaSubmissionService({
  repo,
  uploadService,
  rateLimiter,
  rateLimiters,
  config = {},
}) {
  const limits = {
    nameMax: config.nameMaxLength || 200,
    nameMin: 3,
    descriptionMin: 20,
    descriptionMax: config.descriptionMaxLength || 8000,
    versionMax: config.versionMaxLength || 60,
    strategyMax: 200,
    contactNameMax: 100,
    contactEmailMax: 200,
  };

  /**
   * validate metadata ก่อน rate limit + upload
   * @returns {{ ok: boolean, errors?: string[], sanitized?: object }}
   */
  function validateMetadata(input) {
    const errors = [];
    const out = {};

    // name (required)
    const name = String(input.name || "").trim();
    if (!name) errors.push("name_required");
    else if (name.length < limits.nameMin) errors.push("name_too_short");
    else if (name.length > limits.nameMax) errors.push("name_too_long");
    out.name = name;

    // description (required)
    const desc = String(input.description || "").trim();
    if (!desc) errors.push("description_required");
    else if (desc.length < limits.descriptionMin) errors.push("description_too_short");
    else if (desc.length > limits.descriptionMax) errors.push("description_too_long");
    out.description = desc;

    // version (required)
    const version = String(input.version || "").trim();
    if (!version) errors.push("version_required");
    else if (version.length > limits.versionMax) errors.push("version_too_long");
    out.version = version;

    // platform (required — enum)
    const platform = String(input.platform || "").trim().toLowerCase();
    if (!platform) errors.push("platform_required");
    else if (!VALID_PLATFORMS.includes(platform)) errors.push("platform_invalid");
    out.platform = platform || "mt5";

    // strategy (optional)
    const strategy = String(input.strategy || "").trim();
    if (strategy.length > limits.strategyMax) errors.push("strategy_too_long");
    out.strategy = strategy;

    // contact_name (optional)
    const contactName = String(input.contactName || "").trim();
    if (contactName.length > limits.contactNameMax) errors.push("contact_name_too_long");
    out.contactName = contactName;

    // contact_email (optional — validate if present)
    const email = String(input.contactEmail || "").trim();
    if (email.length > limits.contactEmailMax) errors.push("contact_email_too_long");
    else if (!isValidEmail(email)) errors.push("contact_email_invalid");
    out.contactEmail = email;

    // ===== ห้ามรับ privileged fields จาก client =====
    // status, price, published, downloadUrl, filePath — ไม่สนใจทั้งหมด
    // (เขียนเป็น explicit comment เพื่อ audit trail)

    // generate slug จาก name (server-side เท่านั้น)
    const slug = sanitizeSlug(name);
    if (!slug || !SLUG_RE.test(slug)) {
      errors.push("slug_generation_failed");
    } else if (repo.slugExists(slug)) {
      // dedupe ด้วย suffix random
      const suffix = randomBytes(3).toString("hex");
      out.slug = `${slug}-${suffix}`.slice(0, 120);
    } else {
      out.slug = slug;
    }

    return errors.length ? { ok: false, errors } : { ok: true, sanitized: out };
  }

  /**
   * ส่ง EA submission จริง (จาก public user)
   * @param {object} input
   *   - ip: IP address (สำหรับ rate limit + audit)
   *   - name, description, version, platform, strategy, contactName, contactEmail
   *   - coverFile: { buffer, filename, size } หรือ null
   *   - eaFile: { buffer, filename, size } (required)
   * @returns {{ ok: boolean, id?: string, status?: string, error?: string, status?: number, retryAfterMs?: number }}
   */
  async function submitEa(input) {
    // 1) validate metadata
    const check = validateMetadata(input);
    if (!check.ok) {
      return {
        ok: false,
        error: "validation_failed",
        details: check.errors,
        status: 400,
      };
    }
    const meta = check.sanitized;

    // 2) EA file required
    if (!input.eaFile || !input.eaFile.buffer) {
      return {
        ok: false,
        error: "ea_file_required",
        status: 400,
      };
    }

    // 3) rate limit (IP-based)
    const ipKey = sanitizeIp(input.ip);
    const activeLimiters = Array.isArray(rateLimiters) && rateLimiters.length
      ? rateLimiters
      : [{ name: "submission", limiter: rateLimiter }];
    for (const entry of activeLimiters) {
      const limiter = entry && (entry.limiter || entry);
      if (!limiter || typeof limiter.tryConsume !== "function") continue;
      const rl = limiter.tryConsume(ipKey);
      if (!rl.allowed) {
        log.warn(`rate limit ${entry.name || "submission"} hit for IP ${ipKey}: retryAfter=${rl.retryAfterMs}ms`);
        return {
          ok: false,
          error: "rate_limited",
          status: 429,
          retryAfterMs: rl.retryAfterMs,
        };
      }
    }

    // 4) upload cover (optional) — ก่อน EA file เพื่อ fail fast ถ้ารูปผิด
    let coverResult = null;
    if (input.coverFile && input.coverFile.buffer) {
      try {
        coverResult = await uploadService.uploadImage({
          source: Readable.from([input.coverFile.buffer]),
          filename: input.coverFile.filename || "cover",
          declaredSize: input.coverFile.size || input.coverFile.buffer.length,
        });
      } catch (err) {
        return mapUploadError(err);
      }
    }

    // 5) upload EA file (required)
    let eaResult;
    try {
      eaResult = await uploadService.uploadEa({
        source: Readable.from([input.eaFile.buffer]),
        filename: input.eaFile.filename || "ea.ex5",
        declaredSize: input.eaFile.size || input.eaFile.buffer.length,
      });
    } catch (err) {
      await cleanupUploads([coverResult]);
      return mapUploadError(err);
    }

    // 6) create submission (repo บังคับ status=pending_review)
    try {
      const result = repo.create({
        slug: meta.slug,
        name: meta.name,
        description: meta.description,
        version: meta.version,
        platform: meta.platform,
        strategy: meta.strategy || null,
        contactName: meta.contactName || null,
        contactEmail: meta.contactEmail || null,
        eaFilePath: eaResult.path,
        eaFileName: eaResult.filename,
        eaFileSize: eaResult.size,
        eaFileMime: eaResult.mime,
        coverImagePath: coverResult ? coverResult.path : null,
        submitterIp: ipKey,
      });
      if (!result.created) {
        log.error(`repo.create returned created=false for ${meta.slug}`);
        await cleanupUploads([eaResult, coverResult]);
        return { ok: false, error: "create_failed", status: 500 };
      }
      log.info(`submission created: ${result.id} (slug=${meta.slug})`);
      return {
        ok: true,
        id: result.id,
        slug: meta.slug,
        status: "pending_review",
      };
    } catch (err) {
      log.error(`repo.create threw: ${err.message}`);
      await cleanupUploads([eaResult, coverResult]);
      return { ok: false, error: "create_failed", status: 500 };
    }
  }

  async function cleanupUploads(results) {
    if (typeof uploadService.removeUpload !== "function") return;
    await Promise.all(
      results
        .filter((item) => item && item.path)
        .map((item) => uploadService.removeUpload(item.path).catch((err) => {
          log.error(`cleanup upload failed for ${item.path}: ${err.message}`);
        }))
    );
  }

  /** admin: list pending submissions */
  function listPending(limit = 50, offset = 0) {
    return repo.listPending(limit, offset);
  }

  /** admin: get by id */
  function getById(id) {
    return repo.getById(id);
  }

  /**
   * admin: mark submission rejected (with notes)
   * (approve flow จะโอนไป ea_products ในอีก method หรือทำใน API layer)
   */
  function reject(id, reviewerNotes) {
    const existing = repo.getById(id);
    if (!existing) return { ok: false, error: "not_found", status: 404 };
    if (existing.status !== "pending_review") {
      return { ok: false, error: "already_reviewed", status: 409 };
    }
    const r = repo.updateStatus(id, "rejected", { reviewerNotes });
    return r.updated
      ? { ok: true, id, status: "rejected" }
      : { ok: false, error: "update_failed", status: 500 };
  }

  /**
   * admin: mark submission approved (หลังโอนไป ea_products แล้ว)
   * caller ต้องสร้าง ea_products record เองก่อนเรียก method นี้
   */
  function markMigrated(id, reviewerNotes) {
    const existing = repo.getById(id);
    if (!existing) return { ok: false, error: "not_found", status: 404 };
    if (existing.status !== "pending_review") {
      return { ok: false, error: "already_reviewed", status: 409 };
    }
    const r = repo.updateStatus(id, "migrated", { reviewerNotes });
    return r.updated
      ? { ok: true, id, status: "migrated" }
      : { ok: false, error: "update_failed", status: 500 };
  }

  return {
    submitEa,
    validateMetadata,
    listPending,
    getById,
    reject,
    markMigrated,
    limits,
  };
}

/** map UploadError → service result */
function mapUploadError(err) {
  if (err instanceof UploadError) {
    const code = err.code;
    let status = 400;
    if (code === "file_too_large") status = 413;
    return {
      ok: false,
      error: code,
      message: err.message,
      extra: err.extra,
      status,
    };
  }
  log.error(`upload failed: ${err.message}`);
  return {
    ok: false,
    error: "upload_failed",
    message: err.message,
    status: 500,
  };
}

/** sanitize IP — กัน header injection และ truncate */
function sanitizeIp(ip) {
  if (!ip) return "unknown";
  const s = String(ip).trim();
  // x-forwarded-for: เอา IP แรก
  const first = s.split(",")[0].trim();
  // alphanumeric + dot + colon (IPv6) เท่านั้น
  const cleaned = first.replace(/[^a-zA-Z0-9.:]/g, "").slice(0, 64);
  return cleaned || "unknown";
}
