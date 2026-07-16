/* ============================================================
   Audit Repository — append-only log สำหรับ Auto Pilot
   ------------------------------------------------------------
   กฎ QC:
   - append-only (insert เท่านั้น ไม่มี update/delete)
   - metadata เก็บเป็น JSON string ที่ไม่มี secret
   - stage/status/reason เป็น enum ที่ caller ส่งมา
   ============================================================ */

import { logger } from "../utils/logger.js";

const log = logger.make("audit-repo");

// stages ตามข้อกำหนด Phase 9 (ใช้สำหรับ validation hint เท่านั้น — caller ส่ง stage อะไรก็บันทึกได้)
export const AUDIT_STAGES = Object.freeze({
  RUN_STARTED: "run_started",
  DIGEST_FETCHED: "digest_fetched",
  ARTICLE_SELECTED: "article_selected",
  ARTICLE_SKIPPED: "article_skipped",
  REWRITE_COMPLETED: "rewrite_completed",
  VALIDATION_PASSED: "validation_passed",
  VALIDATION_FAILED: "validation_failed",
  IMAGE_COMPLETED: "image_completed",
  PUBLISH_COMPLETED: "publish_completed",
  PUBLISH_BLOCKED: "publish_blocked",
  RUN_COMPLETED: "run_completed",
  RUN_FAILED: "run_failed",
  EMERGENCY_STOP: "emergency_stop",
  NEWS_ROLLBACK: "news_rollback",
});

/**
 * สร้าง repository bound กับ db instance
 * @param {Database} db
 */
export function createAuditRepository(db) {
  const insertStmt = db.prepare(
    "INSERT INTO auto_pilot_audit " +
      "(run_id, news_id, stage, status, reason, metadata, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  /**
   * เพิ่ม audit entry (append-only)
   * @param {object} entry { runId, newsId?, stage, status, reason?, metadata? }
   * @returns {number} id ของ row ใหม่
   */
  function append(entry) {
    const now = new Date().toISOString();
    const metadataJson = entry.metadata
      ? JSON.stringify(scrubSecrets(entry.metadata))
      : null;
    const info = insertStmt.run(
      entry.runId,
      entry.newsId ?? null,
      entry.stage,
      entry.status,
      entry.reason ?? null,
      metadataJson,
      now
    );
    log.debug(
      `audit: run=${(entry.runId || "").slice(0, 8)} stage=${entry.stage} status=${entry.status}`
    );
    return info.lastInsertRowid;
  }

  /** ดึง audit entries ของ runId หนึ่ง (เรียงตามเวลา) */
  function listByRun(runId) {
    const rows = db
      .prepare(
        "SELECT * FROM auto_pilot_audit WHERE run_id = ? ORDER BY id ASC"
      )
      .all(runId);
    return rows.map(rowToEntry);
  }

  /** ดึง audit entries ล่าสุด */
  function recent(limit = 100) {
    const rows = db
      .prepare(
        "SELECT * FROM auto_pilot_audit ORDER BY id DESC LIMIT ?"
      )
      .all(Math.max(1, Math.min(1000, Math.floor(limit))));
    return rows.map(rowToEntry);
  }

  /** นับ entries ตาม stage ของ runId */
  function countByStage(runId) {
    const rows = db
      .prepare(
        "SELECT stage, COUNT(*) AS cnt FROM auto_pilot_audit WHERE run_id = ? GROUP BY stage"
      )
      .all(runId);
    const out = {};
    for (const r of rows) out[r.stage] = r.cnt;
    return out;
  }

  return { append, listByRun, recent, countByStage };
}

/** แปลง DB row → entry object */
function rowToEntry(row) {
  if (!row) return null;
  let metadata = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    runId: row.run_id,
    newsId: row.news_id,
    stage: row.stage,
    status: row.status,
    reason: row.reason,
    metadata,
    createdAt: row.created_at,
  };
}

/**
 * ลบ secret ออกจาก metadata ก่อนบันทึก (defense-in-depth)
 * - ตัด keys ที่น่าจะเป็น secret (api key, token, password, secret)
 */
function scrubSecrets(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const SECRET_KEYS = /key|token|password|secret|auth/i;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = "[redacted]";
    } else if (v && typeof v === "object") {
      out[k] = scrubSecrets(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
