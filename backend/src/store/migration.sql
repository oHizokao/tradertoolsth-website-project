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

-- ============================================================
-- Phase 12 — Economic Calendar events (Forex Factory)
-- ------------------------------------------------------------
-- กฎ QC:
--   - ตารางแยกจาก news โดยสมบูรณ์ (ไม่กระทบตาราง news)
--   - เก็บเวลาเป็น UTC ใน scheduled_at_utc
--   - source_event_id เป็น deterministic hash (idempotent upsert)
--   - มี Actual ใหม่ → update record เดิม (ไม่สร้างซ้ำ)
--   - ทุก query ใช้ parameterized (จัดการใน repository layer)
--   - idempotent: CREATE ... IF NOT EXISTS ทั้งหมด รันซ้ำได้
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  source_event_id TEXT PRIMARY KEY,        -- deterministic hash (ff-<hash16>)
  source_name TEXT NOT NULL,               -- "Forex Factory"
  source_url TEXT,
  event_name TEXT NOT NULL,
  country TEXT,                            -- รหัสสกุลเงิน (USD/EUR/...)
  currency TEXT,
  impact TEXT NOT NULL,                    -- low / medium / high
  scheduled_at_utc TEXT NOT NULL,          -- ISO UTC (เก็บ UTC เสมอ)
  scheduled_at_bangkok TEXT,               -- ISO เลื่อน +7 (ช่วย query/filter)
  actual TEXT,                             -- NULL จนกว่าจะมี Actual
  forecast TEXT,
  previous TEXT,
  revised TEXT,
  detail_url TEXT,
  is_tentative INTEGER NOT NULL DEFAULT 0, -- 0/1
  last_updated TEXT NOT NULL,              -- UTC ISO ทุกครั้งที่ sync
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_scheduled_at_utc ON calendar_events(scheduled_at_utc);
CREATE INDEX IF NOT EXISTS idx_calendar_currency ON calendar_events(currency);
CREATE INDEX IF NOT EXISTS idx_calendar_impact ON calendar_events(impact);
CREATE INDEX IF NOT EXISTS idx_calendar_source_event_id ON calendar_events(source_event_id);

-- sync metadata (single-row: id='singleton') เก็บสถานะ sync ล่าสุด
-- ใช้สำหรับ stale detection + cache fallback
CREATE TABLE IF NOT EXISTS calendar_sync_meta (
  id TEXT PRIMARY KEY,                     -- เสมอ 'singleton'
  last_sync_at TEXT,                       -- UTC ISO ของ sync สำเร็จล่าสุด
  last_sync_ok INTEGER NOT NULL DEFAULT 0, -- 0/1
  last_error TEXT,
  last_event_count INTEGER,
  source_name TEXT,
  updated_at TEXT NOT NULL
);

-- ============================================================
-- Phase 15 — Community Forum (แยกจาก Content Management Phase 14)
-- ------------------------------------------------------------
-- แยกจากระบบข่าว / auto pilot / calendar / market / content ทั้งหมด
-- กฎ QC:
--   - ทุก query ใช้ parameterized (? placeholders) เท่านั้น
--   - moderation status แยกจาก content เสมอ
--   - soft delete (deleted_at) ไม่ใช่ hard delete (กันข้อมูลหาย + audit)
--   - identity เริ่มต้นเป็น guest profile (ย้ายไป account จริงในอนาคตได้)
--   - idempotent: CREATE ... IF NOT EXISTS ทั้งหมด รันซ้ำได้
-- ============================================================

-- forum_authors: identity ของผู้โพสต์
--   - kind='guest' (default) หรือ 'account' (อนาคต)
--   - display_name ใช้แสดงผล; anon_token ใช้เชื่อมโยงเฉพาะใน browser
--     (ส่งกลับครั้งเดียวตอนสร้าง ไม่เปิดเผยใน API อื่น)
CREATE TABLE IF NOT EXISTS forum_authors (
  id TEXT PRIMARY KEY,                    -- 'fa-' + hash16
  anon_token TEXT NOT NULL UNIQUE,        -- token ลับของ guest (hash)
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'guest',     -- 'guest' | 'account'
  account_id TEXT,                        -- อ้างอิงเมื่อ upgrade เป็น account จริง
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forum_authors_anon_token ON forum_authors(anon_token);

-- forum_categories: หมวดหมู่ (seed 5 หมวดจาก Codex)
--   - slug เป็น identity ภายใน; name/description ใช้แสดงผล
--   - sort_order กำหนดลำดับการ์ดหมวดบนหน้า forum
CREATE TABLE IF NOT EXISTS forum_categories (
  slug TEXT PRIMARY KEY,                  -- 'ea-indicator', 'tricks', ...
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_marketplace INTEGER NOT NULL DEFAULT 0, -- 0/1 — ใช่ห้องซื้อขาย
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- forum_topics: กระทู้ (มีโพสต์แรกฝังในตารางนี้เอง)
--   - author_id → forum_authors.id
--   - category_slug → forum_categories.slug
--   - moderation: 'visible' | 'hidden' | 'deleted'
--   - reply_count / last_activity_at อัปเดตทุกครั้งที่มี reply (เรียงกระทู้)
CREATE TABLE IF NOT EXISTS forum_topics (
  id TEXT PRIMARY KEY,                    -- 'ft-' + hash16
  category_slug TEXT NOT NULL,
  author_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,                     -- plain text (sanitized)
  is_marketplace INTEGER NOT NULL DEFAULT 0,
  moderation TEXT NOT NULL DEFAULT 'visible',
  pinned INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  last_activity_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (category_slug) REFERENCES forum_categories(slug),
  FOREIGN KEY (author_id) REFERENCES forum_authors(id)
);
CREATE INDEX IF NOT EXISTS idx_forum_topics_category ON forum_topics(category_slug);
CREATE INDEX IF NOT EXISTS idx_forum_topics_moderation ON forum_topics(moderation);
CREATE INDEX IF NOT EXISTS idx_forum_topics_last_activity ON forum_topics(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_forum_topics_author ON forum_topics(author_id);

-- forum_posts: คำตอบ/ตอบกลับในกระทู้
--   - topic_id → forum_topics.id
--   - author_id → forum_authors.id
--   - moderation: 'visible' | 'hidden' | 'deleted'
CREATE TABLE IF NOT EXISTS forum_posts (
  id TEXT PRIMARY KEY,                    -- 'fp-' + hash16
  topic_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,                     -- plain text (sanitized)
  moderation TEXT NOT NULL DEFAULT 'visible',
  floor INTEGER NOT NULL,                 -- ลำดับคำตอบในกระทู้ (1, 2, 3 ...)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (topic_id) REFERENCES forum_topics(id),
  FOREIGN KEY (author_id) REFERENCES forum_authors(id)
);
CREATE INDEX IF NOT EXISTS idx_forum_posts_topic ON forum_posts(topic_id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_moderation ON forum_posts(moderation);
CREATE INDEX IF NOT EXISTS idx_forum_posts_author ON forum_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_floor ON forum_posts(topic_id, floor);

-- forum_attachments: metadata ของไฟล์แนบ (เก็บ metadata เท่านั้น ไม่เก็บ binary)
--   - owner_type: 'topic' | 'post'
--   - stored_path: path สัมพันธ์ภายใต้ data/forum/ (validated, กัน path traversal)
--   - mime/extension whitelist (image/pdf/zip เท่านั้น; ห้าม executable)
CREATE TABLE IF NOT EXISTS forum_attachments (
  id TEXT PRIMARY KEY,                    -- 'fa-' + hash16
  owner_type TEXT NOT NULL,               -- 'topic' | 'post'
  owner_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,              -- ชื่อไฟล์ที่ generate (ไม่ใช่ชื่อผู้ใช้ส่ง)
  stored_path TEXT NOT NULL,              -- relative path (validated)
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forum_attachments_owner ON forum_attachments(owner_type, owner_id);

-- forum_reports: report/moderation queue
--   - target_type: 'topic' | 'post'
--   - target_id → forum_topics.id หรือ forum_posts.id
--   - status: 'open' | 'reviewed' | 'dismissed'
CREATE TABLE IF NOT EXISTS forum_reports (
  id TEXT PRIMARY KEY,                    -- 'fr-' + hash16
  target_type TEXT NOT NULL,              -- 'topic' | 'post'
  target_id TEXT NOT NULL,
  reporter_id TEXT,                       -- author ของผู้แจ้ง (อาจ NULL = ไม่ระบุตัว)
  reason TEXT NOT NULL,                   -- sanitized, capped
  status TEXT NOT NULL DEFAULT 'open',    -- 'open' | 'reviewed' | 'dismissed'
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_forum_reports_status ON forum_reports(status);
CREATE INDEX IF NOT EXISTS idx_forum_reports_target ON forum_reports(target_type, target_id);

-- ============================================================
-- Phase 14 — Content Management tables
-- ------------------------------------------------------------
-- กฎ QC (ตามที่ Codex กำหนด):
--   - แยกตารางออกจาก news/calendar โดยสมบูรณ์ (ไม่กระทบเดิม)
--   - id/slug UNIQUE (slug ใช้ใน public URL)
--   - status = 'draft' | 'published' (publish gate อยู่ฝั่ง repository)
--   - เก็บ metadata ของไฟล์/รูป (path + size + mime) — ไม่เก็บไฟล์เองใน DB
--   - ห้ามเก็บ secret/token ใดๆ ในตารางเหล่านี้
--   - idempotent: CREATE ... IF NOT EXISTS ทั้งหมด รันซ้ำได้
-- ============================================================

-- ---- EA products (Expert Advisors) ----
CREATE TABLE IF NOT EXISTS ea_products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT,
  platform TEXT,                        -- 'mt4' | 'mt5' | 'both'
  price REAL NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'free',     -- 'free' | 'paid'
  file_path TEXT,                       -- relative path ใต้ uploads (ไม่เก็บ absolute)
  file_name TEXT,                       -- ชื่อไฟล์ safe ที่ rename แล้ว
  file_size INTEGER,
  file_mime TEXT,
  cover_image TEXT,                     -- relative path ใต้ uploads
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published'
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ea_status ON ea_products(status);
CREATE INDEX IF NOT EXISTS idx_ea_type ON ea_products(type);
CREATE INDEX IF NOT EXISTS idx_ea_sort ON ea_products(sort_order);

-- ---- Knowledge articles ----
CREATE TABLE IF NOT EXISTS knowledge_articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  body TEXT,                            -- JSON array ของ blocks (p/h2/ul/ol)
  category TEXT,
  read_minutes INTEGER,
  cover_image TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_kb_status ON knowledge_articles(status);
CREATE INDEX IF NOT EXISTS idx_kb_category ON knowledge_articles(category);
CREATE INDEX IF NOT EXISTS idx_kb_slug ON knowledge_articles(slug);

-- ---- FAQ ----
CREATE TABLE IF NOT EXISTS faq_items (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_faq_status ON faq_items(status);
CREATE INDEX IF NOT EXISTS idx_faq_sort ON faq_items(sort_order);

-- ---- Broker reviews ----
CREATE TABLE IF NOT EXISTS broker_reviews (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT,
  overview TEXT,
  rating REAL,
  score REAL,
  logo_color TEXT,
  license TEXT,
  regulation TEXT,                      -- JSON array
  spread TEXT,
  commission TEXT,
  deposit_withdraw TEXT,
  platform TEXT,                        -- JSON array
  min_deposit INTEGER,
  pros TEXT,                            -- JSON array
  cons TEXT,                            -- JSON array
  suitable_for TEXT,
  affiliate_disclosure TEXT,
  reference_url TEXT,
  cover_image TEXT,
  reviewed_at TEXT,                     -- วันที่ตรวจสอบล่าสุด
  status TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_broker_status ON broker_reviews(status);
CREATE INDEX IF NOT EXISTS idx_broker_slug ON broker_reviews(slug);
CREATE INDEX IF NOT EXISTS idx_broker_sort ON broker_reviews(sort_order);

-- ============================================================
-- Phase 16 — Public EA Submissions
-- ตารางแยกจาก ea_products: เก็บรายการที่ผู้ใช้ทั่วไปส่งเข้ามา
-- รอ admin ตรวจสอบก่อนโอนไป ea_products (status=published ได้)
-- กฎ QC (safety):
--   - ไม่มีคอลัมน์ price (public submit บังคับฟรีเสมอ — admin กำหนดราคาทีหลังได้ที่ ea_products)
--   - status ถูก CHECK constraint บังคับเป็น pending_review/approved/rejected/migrated
--   - file_path/cover_path เก็บ relative path ใต้ uploads เท่านั้น (defense-in-depth คู่กับ uploadService)
-- ============================================================
CREATE TABLE IF NOT EXISTS ea_submissions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,                 -- 'mt4' | 'mt5' | 'both'
  strategy TEXT,                          -- optional — ประเภทกลยุทธ์
  contact_name TEXT,                      -- ชื่อผู้ส่ง (optional)
  contact_email TEXT,                     -- อีเมลติดต่อ (optional)
  ea_file_path TEXT NOT NULL,             -- relative path ใต้ uploads (rename แล้ว)
  ea_file_name TEXT,                      -- ชื่อไฟล์ safe
  ea_file_size INTEGER,
  ea_file_mime TEXT,
  cover_image_path TEXT,                  -- relative path ใต้ uploads (optional)
  submitter_ip TEXT,                      -- IP ผู้ส่ง (สำหรับ rate limit + audit)
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','rejected','migrated')),
  reviewer_notes TEXT,                    -- หมายเหตุ admin (กรณี reject)
  reviewed_at TEXT,                       -- วันที่ admin ตัดสินใจ
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ea_submission_status ON ea_submissions(status);
CREATE INDEX IF NOT EXISTS idx_ea_submission_created ON ea_submissions(created_at DESC);
