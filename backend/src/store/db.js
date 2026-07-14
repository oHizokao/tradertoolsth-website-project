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
  log.debug("migrations applied");
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
