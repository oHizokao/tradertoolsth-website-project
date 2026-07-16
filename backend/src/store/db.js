/* ============================================================
   Database — SQLite connection + idempotent migration + transaction
   ------------------------------------------------------------
   - ใช้ better-sqlite3 (sync API, embedded)
   - DATABASE_URL รูปแบบ "file:<path>" หรือ path ตรง หรือ ":memory:"
   - runMigrations() idempotent (CREATE ... IF NOT EXISTS)
   - withTransaction(fn) ใช้ SQLite native transaction (ครอบ dedup+insert
     ใน transaction เดียวกันเพื่อกัน race condition)
   - pragma: WAL + foreign_keys + busy_timeout
   ============================================================ */

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { toUtcIso } from "../utils/date.js";

const log = logger.make("db");
const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(__dirname, "..", "..");

const MIGRATION_FILE = join(__dirname, "migration.sql");

let _db = null;

/** แปลง DATABASE_URL ("file:./data/news.db" หรือ path) เป็น path จริง */
function resolveDbPath(databaseUrl) {
  const url = databaseUrl || config.storage.databaseUrl;
  if (!url || url === ":memory:") return ":memory:";
  // ตัด prefix "file:"
  let p = url.startsWith("file:") ? url.slice(5) : url;
  // ถ้าเป็น relative path ให้ resolve จาก backend root (ที่ dataDir อยู่)
  if (!isAbsolute(p) && /^[a-zA-Z]:/.test(p) === false && !p.startsWith("\\")) {
    // Relative DATABASE_URL is resolved from the backend root.
    // file:./data/news.db -> <backend>/data/news.db (not data/data/news.db).
    p = resolve(BACKEND_ROOT, p);
    mkdirSync(dirname(p), { recursive: true });
  } else {
    // absolute → สร้าง parent dir ถ้ายังไม่มี
    const dir = dirname(p);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  return p;
}

/**
 * เปิด connection ไปยัง SQLite
 * - ใส่ pragma ที่จำเป็น (WAL/fk/busy_timeout)
 * - รัน migration อัตโนมัติ (idempotent)
 *
 * @param {object} opts { databaseUrl?: override, migrate?: default true }
 * @returns {Database} better-sqlite3 instance
 */
export function openDb(opts = {}) {
  if (_db && !opts.databaseUrl) return _db;

  const dbPath = resolveDbPath(opts.databaseUrl);
  log.info(`opening SQLite: ${dbPath === ":memory:" ? ":memory:" : dbPath}`);

  const db = new Database(dbPath, {
    // ไม่เปิด readonly เพราะต้อง insert/update
    readonly: false,
  });

  // pragma — WAL ช่วย concurrency + crash safety
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  if (opts.migrate !== false) {
    runMigrationsOn(db);
  }

  if (!opts.databaseUrl) _db = db; // cache singleton (เฉพาะ default path)
  return db;
}

/** รัน migration บน db ที่กำหนด (idempotent) */
function runMigrationsOn(db) {
  const sql = readFileSync(MIGRATION_FILE, "utf8");
  db.exec(sql);
  // บันทึก migration row (idempotent)
  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)"
  ).run(1, new Date().toISOString());
  // Phase 8: idempotent ALTER + validate migration
  applyPhase8Migration(db);
  // Phase 9: bootstrap auto pilot tables + auto-release crash lock
  applyPhase9Migration(db);
  log.debug("migrations applied");
}

/**
 * Phase 8 migration — เพิ่มคอลัมน์ source_published_at + migrate ข้อมูลเดิม
 *
 * SQLite ไม่รองรับ ADD COLUMN IF NOT EXISTS → ตรวจ PRAGMA table_info ก่อน
 *
 * กฎ QC (ห้าม fallback / ห้ามเดา):
 *   - migrate จาก original_published_at เฉพาะค่าที่ parse เป็น ISO UTC ได้จริง
 *   - ค่าที่ parse ไม่ได้ → เก็บ source_published_at = NULL
 *     และตั้ง validation_status = 'needs_review' (ไม่ให้ปรากฏใน public listing)
 *
 * การแยกระดับ idempotency (QC4):
 *   - column + index: ตรวจและสร้างเสมอทุกครั้ง (กันกรณี DB มี id=2 แต่
 *     column/index หายไป เช่น restore บางส่วน) — ไม่ข้ามแม้ id=2 มีอยู่
 *   - data migration (copy original_published_at): ทำครั้งเดียวตาม id=2
 *     เพื่อกันการทำซ้ำ
 */
function applyPhase8Migration(db) {
  // 1) column + index — ตรวจและสร้างเสมอ (idempotent, ไม่ขึ้นกับ id=2)
  //    กันกรณี DB มี schema_migrations id=2 แต่ column/index หายไป
  const cols = db.prepare("PRAGMA table_info(news)").all();
  const hasCol = cols.some((c) => c.name === "source_published_at");
  if (!hasCol) {
    db.exec("ALTER TABLE news ADD COLUMN source_published_at TEXT");
    log.info("phase8: added column source_published_at");
  }
  // สร้าง index สำหรับเรียงข่าวตาม sourcePublishedAt (CREATE IF NOT EXISTS idempotent)
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_news_source_published_at ON news(source_published_at)"
  );

  // 2) data migration — ทำครั้งเดียวตาม schema_migrations id=2
  const dataMigrated = db
    .prepare("SELECT id FROM schema_migrations WHERE id = ?")
    .get(2);
  if (dataMigrated) return; // data migration ทำไปแล้ว — แต่ column/index ยังตรวจเสมอข้างต้น

  const rows = db
    .prepare(
      "SELECT id, original_published_at FROM news " +
        "WHERE source_published_at IS NULL " +
        "AND original_published_at IS NOT NULL " +
        "AND original_published_at != ''"
    )
    .all();

  let migrated = 0;
  let needsReview = 0;
  const updateSourceStmt = db.prepare(
    "UPDATE news SET source_published_at = ? WHERE id = ?"
  );
  const markNeedsReviewStmt = db.prepare(
    "UPDATE news SET source_published_at = NULL, validation_status = 'needs_review' " +
      "WHERE id = ?"
  );

  for (const r of rows) {
    const iso = toUtcIso(r.original_published_at);
    if (iso) {
      updateSourceStmt.run(iso, r.id);
      migrated++;
    } else {
      // parse ไม่ได้ → NULL + needs_review (ห้ามเดา ห้าม fallback)
      markNeedsReviewStmt.run(r.id);
      needsReview++;
    }
  }

  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)"
  ).run(2, new Date().toISOString());

  if (rows.length > 0) {
    log.info(
      `phase8: migrated ${migrated} rows, ${needsReview} sent to needs_review`
    );
  }
}

/**
 * Phase 9 migration — bootstrap auto pilot tables + auto-release crash lock
 *
 * tables สร้างผ่าน migration.sql (CREATE IF NOT EXISTS) ทำเสมอ
 * ส่วนนี้ทำ 2 อย่าง (run-once ตาม schema_migrations id=3):
 *   1. bootstrap singleton row ของ auto_pilot_settings (ถ้ายังไม่มี)
 *   2. กัน lock ค้าง: ถ้า status='running' ตอนเปิด (process crash ระหว่างรอบ)
 *      → ตั้ง 'stopped_error' + release lock_token + last_error
 *      (ทำทุกครั้งตอนเปิด ไม่ใช่แค่ id=3 — safety)
 */
function applyPhase9Migration(db) {
  // bootstrap singleton row (idempotent INSERT OR IGNORE)
  db.prepare(
    "INSERT OR IGNORE INTO auto_pilot_settings " +
      "(id, enabled, status, max_per_run, emergency_stop, updated_at) " +
      "VALUES ('singleton', 0, 'off', 3, 0, ?)"
  ).run(new Date().toISOString());

  // auto-release crash lock — ทำเสมอทุกครั้งตอนเปิด (safety, ไม่ใช่ id=3 only)
  // ถ้า status='running' แสดงว่า process ก่อนหน้า crash ระหว่างรอบ → ปล่อย lock
  const row = db
    .prepare("SELECT status, lock_token FROM auto_pilot_settings WHERE id = 'singleton'")
    .get();
  if (row && row.status === "running") {
    db.prepare(
      "UPDATE auto_pilot_settings " +
        "SET status = 'stopped_error', lock_token = NULL, " +
        "last_error = 'process_restart_during_run', updated_at = ? " +
        "WHERE id = 'singleton'"
    ).run(new Date().toISOString());
    log.warn(
      "phase9: auto-released crash lock (status was 'running' on startup) → stopped_error"
    );
  }

  // บันทึก migration v3 (run-once marker)
  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)"
  ).run(3, new Date().toISOString());
}

/**
 * ปิด connection (สำหรับ test restart หรือ shutdown)
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
    log.debug("db closed");
  }
}

/**
 * Transaction helper — ครอบหลาย operation ใน transaction เดียว
 * better-sqlite3 ใช้ .transaction() ซึ่ง COMMIT เมื่อ fn return
 * และ ROLLBACK อัตโนมัติเมื่อ fn throw
 *
 * @param {Database} db
 * @param {() => T} fn
 * @returns {T} ผลลัพธ์ของ fn
 */
export function withTransaction(db, fn) {
  const tx = db.transaction(fn);
  return tx();
}

/**
 * สร้าง fresh database (สำหรับ test) — ใช้ :memory: หรือ temp path
 * ไม่ cache เป็น singleton
 */
export function createTestDb(opts = {}) {
  const dbPath = opts.databaseUrl || ":memory:";
  const db = new Database(dbPath, { readonly: false });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrationsOn(db);
  return db;
}

export { runMigrationsOn as __runMigrationsOn };
export { resolveDbPath as __resolveDbPath };
