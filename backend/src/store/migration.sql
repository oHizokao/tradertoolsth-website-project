-- ============================================================
-- Phase 5 — News storage schema (SQLite)
-- ------------------------------------------------------------
-- กฎ (QC):
--   - original_content ไม่ UNIQUE (dedup ผ่าน source_url + duplicate_hash
--     ใน repository layer แทน)
--   - validation_status แยกจาก publish_status ตลอด
--   - เก็บ image URL + metadata เท่านั้น (ห้ามเก็บไฟล์รูป)
--   - idempotent: ใช้ CREATE ... IF NOT EXISTS ทั้งหมด รันซ้ำได้
-- ============================================================

-- main news table
CREATE TABLE IF NOT EXISTS news (
  -- identity / source
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_url TEXT,
  original_title TEXT,
  original_author TEXT,
  original_published_at TEXT,
  category TEXT,
  original_content TEXT,           -- ไม่ UNIQUE (dedup ใน repository)

  -- thai rewrite
  thai_title TEXT,
  thai_summary TEXT,
  thai_content TEXT,               -- JSON array ของ paragraphs
  market_factors TEXT,
  key_facts TEXT,                  -- JSON array
  mentioned_numbers TEXT,          -- JSON array
  credit TEXT,

  -- image (URL + metadata เท่านั้น — ห้ามเก็บไฟล์)
  image_url TEXT,
  image_source TEXT,
  image_author TEXT,
  image_author_url TEXT,
  image_license TEXT,
  image_source_url TEXT,
  image_search_keywords TEXT,      -- JSON array
  image_status TEXT,               -- selected/fallback/failed
  image_review_required INTEGER,   -- 0/1

  -- validation / publish (แยกชัด)
  validation_status TEXT NOT NULL,
  publish_status TEXT NOT NULL,
  ai_confidence INTEGER,
  ai_validation TEXT,              -- JSON (อาจ NULL)
  duplicate_hash TEXT,
  source_policy TEXT,
  source_policy_reason TEXT,

  -- scraper metadata
  topics TEXT,                     -- JSON array
  section TEXT,
  teaser TEXT,
  is_external INTEGER,             -- 0/1
  pipeline_note TEXT,

  -- timestamps แยก
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  validated_at TEXT,               -- NULL จนกว่า validation_status=validated
  published_at TEXT                -- NULL จนกว่าจะ explicit publish
);

-- indexes (Phase 5: ตามที่ Codex กำหนด)
CREATE INDEX IF NOT EXISTS idx_news_source_url ON news(source_url);
CREATE INDEX IF NOT EXISTS idx_news_dup_hash ON news(duplicate_hash);
CREATE INDEX IF NOT EXISTS idx_news_validation_status ON news(validation_status);
CREATE INDEX IF NOT EXISTS idx_news_publish_status ON news(publish_status);
CREATE INDEX IF NOT EXISTS idx_news_published_at ON news(original_published_at);

-- migration version tracking (idempotent)
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ------------------------------------------------------------
-- Phase 9 — Auto Pilot tables
-- ------------------------------------------------------------
-- auto_pilot_settings: single-row (id='singleton') เก็บสถานะ + config
--   - enabled: สวิตช์ on/off ระดับ database (ต้อง env+db อนุญาตทั้งคู่)
--   - status: off | idle | running | stopped_error
--   - max_per_run: จำนวนข่าวต่อรอบ (default 3)
--   - emergency_stop: flag หยุดด่วน (รอบที่กำลังรันจะเห็นและหยุดก่อนข่าวถัดไป)
--   - lock_token: UUID ที่ออกตอน acquire lock (atomic CAS)
CREATE TABLE IF NOT EXISTS auto_pilot_settings (
  id TEXT PRIMARY KEY,             -- เสมอ 'singleton'
  enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'off',
  max_per_run INTEGER NOT NULL DEFAULT 3,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  emergency_stop INTEGER NOT NULL DEFAULT 0,
  lock_token TEXT,
  updated_at TEXT NOT NULL
);

-- auto_pilot_audit: append-only log (index ตาม QC)
CREATE TABLE IF NOT EXISTS auto_pilot_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  news_id TEXT,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  metadata TEXT,                  -- JSON ที่ไม่มี secret
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ap_audit_run_id ON auto_pilot_audit(run_id);
CREATE INDEX IF NOT EXISTS idx_ap_audit_news_id ON auto_pilot_audit(news_id);
CREATE INDEX IF NOT EXISTS idx_ap_audit_stage ON auto_pilot_audit(stage);
CREATE INDEX IF NOT EXISTS idx_ap_audit_created_at ON auto_pilot_audit(created_at);

-- ------------------------------------------------------------
-- Phase 8 — source_published_at column
-- ------------------------------------------------------------
-- คอลัมน์นี้เก็บเวลาเผยแพร่จริงจาก Kitco (createdAt) ในรูป ISO 8601 UTC
-- (suffix Z) เช่น "2026-07-15T13:59:00.000Z"
--
-- กฎ QC (ห้าม fallback):
--   - ตัวเรียงข่าวหลักใช้ source_published_at DESC เท่านั้น
--   - ข่าวที่ source_published_at IS NULL จะไม่ปรากฏใน public listing
--   - คอลัมน์เพิ่มผ่าน idempotent ALTER TABLE ใน db.js (PRAGMA check)
--     เพราะ SQLite ไม่รองรับ ADD COLUMN IF NOT EXISTS
--   - migration ข้อมูลเดิม (จาก original_published_at) ต้องผ่านการ
--     validate parse ใน db.js ก่อน มิฉะนั้นเก็บ NULL + needs_review
