/* ============================================================
   EA Submission Repository — Phase 16
   ------------------------------------------------------------
   เก็บรายการที่ผู้ใช้ทั่วไปส่ง EA เข้ามา (status=pending_review)
   แยกจาก contentRepository (ea_products) อย่างชัดเจน

   กฎ QC (safety):
   - ทุก query ใช้ parameterized (? placeholders)
   - id สุ่ม (crypto random hex)
   - status บังคับเริ่มต้น 'pending_review' — caller ส่ง status มาก็ตาม
     repo จะ override ไม่ให้ public กำหนดสถานะเอง (เขียนแบบ hardcode)
   - public listing ไม่มี (admin เท่านั้นที่ดูได้)
   ============================================================ */

import { randomBytes } from "node:crypto";
import { logger } from "../utils/logger.js";

const log = logger.make("ea-submission-repo");

const TABLE = "ea_submissions";
const ID_PREFIX = "easub";

// columns ที่ insert ได้ (ไม่รวม id — repo generate เอง)
// NOTE: status ไม่อยู่ในนี้เพราะ repo บังคับ pending_review เสมอ
const INSERT_COLUMNS = [
  "slug",
  "name",
  "description",
  "version",
  "platform",
  "strategy",
  "contact_name",
  "contact_email",
  "ea_file_path",
  "ea_file_name",
  "ea_file_size",
  "ea_file_mime",
  "cover_image_path",
  "submitter_ip",
  "reviewer_notes",
  "reviewed_at",
  "created_at",
  "updated_at",
];

export function createEaSubmissionRepository(db) {
  const placeholders = INSERT_COLUMNS.map(() => "?").join(", ");
  const insertSql = `INSERT INTO ${TABLE} (id, ${INSERT_COLUMNS.join(
    ", "
  )}, status) VALUES (?, ${placeholders}, 'pending_review')`;

  const stmts = {
    insert: db.prepare(insertSql),
    getById: db.prepare(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`),
    listAll: db.prepare(
      `SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ),
    listByStatus: db.prepare(
      `SELECT * FROM ${TABLE} WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ),
    countAll: db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`),
    countByStatus: db.prepare(
      `SELECT status, COUNT(*) AS cnt FROM ${TABLE} GROUP BY status`
    ),
    existsSlug: db.prepare(
      `SELECT id FROM ${TABLE} WHERE slug = ? LIMIT 1`
    ),
    setStatus: db.prepare(
      `UPDATE ${TABLE} SET status = ?, reviewer_notes = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`
    ),
  };

  function makeId() {
    return `${ID_PREFIX}-${randomBytes(8).toString("hex")}`;
  }

  function rowToObj(row) {
    if (!row) return null;
    const obj = {};
    for (const key of Object.keys(row)) {
      // snake_case → camelCase
      const camel = key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
      obj[camel] = row[key];
    }
    obj.id = row.id;
    return obj;
  }

  /**
   * insert submission ใหม่ — status ถูกบังคับ pending_review
   * @param {object} input — fields ที่ insert ได้ (camelCase keys)
   * @returns {{ created: boolean, id: string }}
   */
  function create(input) {
    const id = makeId();
    const now = new Date().toISOString();
    const params = [id];
    for (const col of INSERT_COLUMNS) {
      const camelKey = col.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
      const v = input[camelKey] ?? input[col];
      if (col === "created_at" || col === "updated_at") {
        params.push(now);
      } else if (col === "reviewed_at") {
        params.push(v ? String(v) : null);
      } else {
        params.push(v === undefined ? null : v);
      }
    }
    try {
      const info = stmts.insert.run(...params);
      return { created: info.changes > 0, id };
    } catch (err) {
      log.error(`create ${TABLE} failed: ${err.message}`);
      throw err;
    }
  }

  function getById(id) {
    return rowToObj(stmts.getById.get(id));
  }

  function listAll(limit = 100, offset = 0) {
    const rows = stmts.listAll.all(
      Math.min(1000, Math.max(1, limit)),
      Math.max(0, offset)
    );
    return rows.map(rowToObj);
  }

  function listByStatus(status, limit = 100, offset = 0) {
    const rows = stmts.listByStatus.all(
      status,
      Math.min(1000, Math.max(1, limit)),
      Math.max(0, offset)
    );
    return rows.map(rowToObj);
  }

  function listPending(limit = 100, offset = 0) {
    return listByStatus("pending_review", limit, offset);
  }

  /**
   * อัปเดตสถานะ submission — ใช้สำหรับ admin approve/reject/migrated
   * @param {string} id
   * @param {string} status — approved|rejected|migrated
   * @param {object} opts { reviewerNotes?, reviewedAt? }
   * @returns {{ updated: boolean }}
   */
  function updateStatus(id, status, opts = {}) {
    const now = new Date().toISOString();
    const notes = opts.reviewerNotes ? String(opts.reviewerNotes).slice(0, 1000) : null;
    const reviewedAt = opts.reviewedAt || now;
    const info = stmts.setStatus.run(status, notes, reviewedAt, now, id);
    return { updated: info.changes > 0 };
  }

  function slugExists(slug) {
    return !!stmts.existsSlug.get(slug);
  }

  function countAll() {
    return stmts.countAll.get().n;
  }

  function countByStatus() {
    const rows = stmts.countByStatus.all();
    const out = {};
    for (const r of rows) out[r.status] = r.cnt;
    return out;
  }

  return {
    create,
    getById,
    listAll,
    listByStatus,
    listPending,
    updateStatus,
    slugExists,
    countAll,
    countByStatus,
    table: TABLE,
  };
}
