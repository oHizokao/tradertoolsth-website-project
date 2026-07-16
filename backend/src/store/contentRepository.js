/* ============================================================
   Content Repository — CRUD + publish gate สำหรับ Content Management
   ------------------------------------------------------------
   รองรับ 4 entity: ea_products, knowledge_articles, faq_items, broker_reviews

   กฎ QC (safety):
   - ทุก query ใช้ parameterized (? placeholders) เท่านั้น
   - id สุ่ม (crypto random hex) + slug UNIQUE
   - publish gate: สามารถ publish ได้เฉพาะ record ที่ผ่านเงื่อนไขขั้นต่ำ
     (มี required field) — ไม่ใช่แค่ toggle สถานะ
   - public listing คืนเฉพาะ status='published' เท่านั้น
   - admin listing คืนทุกสถานะ แต่ไม่เผย secret (ไม่มี field secret อยู่แล้ว)
   - ห้ามเก็บ absolute path ใน file_path/cover_image (relative เท่านั้น)
   ============================================================ */

import { randomBytes } from "node:crypto";
import { logger } from "../utils/logger.js";

const log = logger.make("content-repo");

/** สร้าง id แบบสุ่มปลอดภัย (16 hex = 64-bit entropy) */
function makeId(prefix) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

/** แปลง ISO date string → ISO date string (validate) หรือ null */
function isoOr(value) {
  if (!value) return null;
  const s = String(value);
  // YYYY-MM-DD หรือ full ISO → ใช้ได้
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return s;
  return null;
}

/* ============================================================
   Generic factory — สร้าง repository สำหรับ table ใดๆ ที่มี id/slug/status
   ------------------------------------------------------------
   config:
     - table: ชื่อตาราง
     - idPrefix: prefix ของ id
     - columns: [{ name, json?: boolean, optional?: boolean }]
     - requiredForPublish: รายชื่อ column ที่ต้องมีก่อนจึง publish ได้
   ============================================================ */
function createContentRepo(db, config) {
  const { table, idPrefix, columns, requiredForPublish = [], hasSlug = true } = config;
  const allCols = ["id", ...columns.map((c) => c.name)];

  const insertSql = `INSERT INTO ${table} (${allCols.join(", ")}) VALUES (${allCols
    .map(() => "?")
    .join(", ")})`;

  // build SET clause สำหรับ update (ยกเว้น id, created_at)
  const updatableCols = columns.filter((c) => c.name !== "created_at");
  const updateSetSql = updatableCols
    .map((c) => `${c.name} = ?`)
    .join(", ");

  // prepared statements (สร้างครั้งเดียว)
  // NOTE: statements ที่ใช้ slug จะถูกเตรียมแบบมีเงื่อนไข (เฉพาะ table ที่มี slug column)
  const stmts = {
    insert: db.prepare(insertSql),
    updateById: db.prepare(
      `UPDATE ${table} SET ${updateSetSql}, updated_at = ? WHERE id = ?`
    ),
    getById: db.prepare(`SELECT * FROM ${table} WHERE id = ?`),
    deleteById: db.prepare(`DELETE FROM ${table} WHERE id = ?`),
    listAll: db.prepare(
      `SELECT * FROM ${table} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ),
    listByStatus: db.prepare(
      `SELECT * FROM ${table} WHERE status = ? ORDER BY sort_order ASC, created_at DESC LIMIT ? OFFSET ?`
    ),
    countAll: db.prepare(`SELECT COUNT(*) AS n FROM ${table}`),
    countByStatus: db.prepare(
      `SELECT status, COUNT(*) AS cnt FROM ${table} GROUP BY status`
    ),
    listPublishedPublic: db.prepare(
      `SELECT * FROM ${table} WHERE status = 'published' ORDER BY sort_order ASC, COALESCE(published_at, created_at) DESC LIMIT ? OFFSET ?`
    ),
    getPublishedPublic: db.prepare(
      `SELECT * FROM ${table} WHERE id = ? AND status = 'published' LIMIT 1`
    ),
    setStatus: db.prepare(
      `UPDATE ${table} SET status = ?, published_at = ?, updated_at = ? WHERE id = ?`
    ),
  };
  // statements ที่ใช้ slug — เตรียมเฉพาะ table ที่มี slug
  if (hasSlug) {
    stmts.getBySlug = db.prepare(`SELECT * FROM ${table} WHERE slug = ? LIMIT 1`);
    stmts.getPublishedBySlug = db.prepare(
      `SELECT * FROM ${table} WHERE slug = ? AND status = 'published' LIMIT 1`
    );
    stmts.existsSlug = db.prepare(
      `SELECT id FROM ${table} WHERE slug = ? AND id != ? LIMIT 1`
    );
  }

  // ---- encode/decode helpers (row ↔ object) ----
  // row ใช้ snake_case column names ตาม SQLite; object ที่คืนใช้ camelCase
  // (สอดคล้องกับ sanitizer และ public API contract)
  function rowToObj(row) {
    if (!row) return null;
    const obj = {};
    for (const c of columns) {
      const v = row[c.name];
      obj[snakeToCamel(c.name)] = c.json ? safeParseJson(v) : v;
    }
    obj.id = row.id;
    return obj;
  }

  function safeParseJson(s) {
    if (s === null || s === undefined || s === "") return [];
    if (typeof s !== "string") return s;
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) || (parsed && typeof parsed === "object")
        ? parsed
        : [];
    } catch {
      return [];
    }
  }

  // ---- CREATE ----
  /**
   * insert row ใหม่
   * @param {object} input sanitized object (camelCase keys)
   * @returns {{ created: boolean, id: string }}
   */
  function create(input) {
    const id = makeId(idPrefix);
    const now = new Date().toISOString();
    const params = [id];
    for (const c of columns) {
      const v = input[camelToKey(c.name)] ?? input[c.name];
      params.push(encodeValue(v, c, now));
    }
    try {
      const info = stmts.insert.run(...params);
      return { created: info.changes > 0, id };
    } catch (err) {
      log.error(`create ${table} failed: ${err.message}`);
      throw err;
    }
  }

  // ---- READ (admin — all statuses) ----
  function getById(id) {
    return rowToObj(stmts.getById.get(id));
  }
  function getBySlug(slug) {
    if (!hasSlug || !stmts.getBySlug) return null;
    return rowToObj(stmts.getBySlug.get(slug));
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

  // ---- READ (public — published only) ----
  function getPublishedById(id) {
    return rowToObj(stmts.getPublishedPublic.get(id));
  }
  function getPublishedBySlug(slug) {
    if (!hasSlug || !stmts.getPublishedBySlug) return null;
    return rowToObj(stmts.getPublishedBySlug.get(slug));
  }
  function listPublished(limit = 100, offset = 0) {
    const rows = stmts.listPublishedPublic.all(
      Math.min(1000, Math.max(1, limit)),
      Math.max(0, offset)
    );
    return rows.map(rowToObj);
  }

  // ---- UPDATE ----
  /**
   * update row โดย id
   * @param {string} id
   * @param {object} input sanitized object (camelCase keys, เฉพาะ field ที่จะ update)
   * @returns {{ updated: boolean }}
   */
  function update(id, input) {
    const existing = stmts.getById.get(id);
    if (!existing) return { updated: false };
    const now = new Date().toISOString();
    const params = [];
    for (const c of updatableCols) {
      const key = camelToKey(c.name);
      // ใช้ค่าใหม่ถ้ามีใน input มา ไม่งั้นใช้ของเดิม (partial update)
      const newVal = input && (key in input || c.name in input)
        ? input[key] ?? input[c.name]
        : decodeValueForUpdate(existing[c.name], c);
      params.push(encodeValue(newVal, c, now));
    }
    params.push(now, id);
    const info = stmts.updateById.run(...params);
    return { updated: info.changes > 0 };
  }

  /** ดึงค่าเดิมจาก row สำหรับ field ที่ไม่ได้ส่งมา update */
  function decodeValueForUpdate(rawValue, c) {
    if (c.json) return safeParseJson(rawValue);
    return rawValue;
  }

  // ---- DELETE ----
  function remove(id) {
    const info = stmts.deleteById.run(id);
    return { deleted: info.changes > 0 };
  }

  // ---- PUBLISH GATE ----
  /**
   * publish row → status='published' + published_at=now
   * ผ่านเฉพาะเมื่อมี required field ครบ (gate)
   * @returns {{ published: boolean, error?: string }}
   */
  function publish(id) {
    const row = stmts.getById.get(id);
    if (!row) return { published: false, error: "not_found" };
    // gate: ตรวจ required field (decode json ก่อน check)
    const missing = [];
    for (const colName of requiredForPublish) {
      const c = columns.find((x) => x.name === colName);
      const v = c && c.json ? safeParseJson(row[colName]) : row[colName];
      const isEmpty =
        v === null ||
        v === undefined ||
        v === "" ||
        (Array.isArray(v) && v.length === 0);
      if (isEmpty) missing.push(colName);
    }
    if (missing.length) {
      return { published: false, error: "missing_required", missing };
    }
    const now = new Date().toISOString();
    const info = stmts.setStatus.run("published", now, now, id);
    return { published: info.changes > 0 };
  }

  /** unpublish row → status='draft' (เก็บ published_at ไว้) */
  function unpublish(id) {
    const row = stmts.getById.get(id);
    if (!row) return { unpublished: false, error: "not_found" };
    const now = new Date().toISOString();
    const info = stmts.setStatus.run("draft", row.published_at, now, id);
    return { unpublished: info.changes > 0 };
  }

  // ---- slug uniqueness ----
  function slugExists(slug, excludeId = "") {
    if (!hasSlug || !stmts.existsSlug) return false;
    const r = stmts.existsSlug.get(slug, excludeId);
    return !!r;
  }

  // ---- stats ----
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
    getBySlug,
    listAll,
    listByStatus,
    getPublishedById,
    getPublishedBySlug,
    listPublished,
    update,
    remove,
    publish,
    unpublish,
    slugExists,
    countAll,
    countByStatus,
    table,
  };
}

/** แปลง snake_case column name → camelCase (สำหรับ lookup ใน input object) */
function camelToKey(snake) {
  // file_path → filePath, cover_image → coverImage
  return snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** alias — snake_to_camel */
const snakeToCamel = camelToKey;

/** encode value สำหรับ bind ลง prepared statement */
function encodeValue(value, columnDef, now) {
  const { name, json, optional } = columnDef;
  if (json) {
    return value === undefined || value === null ? "[]" : JSON.stringify(value);
  }
  if (name === "created_at" && (value === undefined || value === null)) return now;
  if (name === "updated_at" && (value === undefined || value === null)) return now;
  if (name === "published_at") return value ? isoOr(value) : null;
  if (name === "reviewed_at") return value ? isoOr(value) : null;
  if (optional && (value === undefined || value === null)) return null;
  if (value === undefined || value === null) return null;
  return value;
}

/* ============================================================
   Column definitions สำหรับแต่ละ entity
   ============================================================ */

const EA_COLUMNS = [
  { name: "slug" },
  { name: "name" },
  { name: "description", optional: true },
  { name: "version", optional: true },
  { name: "platform", optional: true },
  { name: "price" },
  { name: "type" },
  { name: "file_path", optional: true },
  { name: "file_name", optional: true },
  { name: "file_size", optional: true },
  { name: "file_mime", optional: true },
  { name: "cover_image", optional: true },
  { name: "status" },
  { name: "sort_order" },
  { name: "created_at" },
  { name: "updated_at" },
  { name: "published_at", optional: true },
];

const ARTICLE_COLUMNS = [
  { name: "slug" },
  { name: "title" },
  { name: "excerpt", optional: true },
  { name: "body", json: true, optional: true }, // JSON array
  { name: "category", optional: true },
  { name: "read_minutes", optional: true },
  { name: "cover_image", optional: true },
  { name: "status" },
  { name: "sort_order" },
  { name: "created_at" },
  { name: "updated_at" },
  { name: "published_at", optional: true },
];

const FAQ_COLUMNS = [
  { name: "question" },
  { name: "answer" },
  { name: "category", optional: true },
  { name: "status" },
  { name: "sort_order" },
  { name: "created_at" },
  { name: "updated_at" },
  { name: "published_at", optional: true },
];

const BROKER_COLUMNS = [
  { name: "slug" },
  { name: "name" },
  { name: "short_name", optional: true },
  { name: "overview", optional: true },
  { name: "rating", optional: true },
  { name: "score", optional: true },
  { name: "logo_color", optional: true },
  { name: "license", optional: true },
  { name: "regulation", json: true, optional: true },
  { name: "spread", optional: true },
  { name: "commission", optional: true },
  { name: "deposit_withdraw", optional: true },
  { name: "platform", json: true, optional: true },
  { name: "min_deposit", optional: true },
  { name: "pros", json: true, optional: true },
  { name: "cons", json: true, optional: true },
  { name: "suitable_for", optional: true },
  { name: "affiliate_disclosure", optional: true },
  { name: "reference_url", optional: true },
  { name: "cover_image", optional: true },
  { name: "reviewed_at", optional: true },
  { name: "status" },
  { name: "sort_order" },
  { name: "created_at" },
  { name: "updated_at" },
  { name: "published_at", optional: true },
];

/** factory รวมสร้าง repositories ทั้ง 4 ตัว */
export function createContentRepositories(db) {
  return {
    ea: createContentRepo(db, {
      table: "ea_products",
      idPrefix: "ea",
      columns: EA_COLUMNS,
      requiredForPublish: ["name", "slug", "version", "platform", "file_path"],
    }),
    article: createContentRepo(db, {
      table: "knowledge_articles",
      idPrefix: "kb",
      columns: ARTICLE_COLUMNS,
      requiredForPublish: ["title", "slug"],
    }),
    faq: createContentRepo(db, {
      table: "faq_items",
      idPrefix: "faq",
      columns: FAQ_COLUMNS,
      requiredForPublish: ["question", "answer"],
      hasSlug: false,
    }),
    broker: createContentRepo(db, {
      table: "broker_reviews",
      idPrefix: "broker",
      columns: BROKER_COLUMNS,
      requiredForPublish: ["name", "slug"],
    }),
  };
}
