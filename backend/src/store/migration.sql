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
