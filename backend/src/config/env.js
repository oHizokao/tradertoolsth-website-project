/* ============================================================
   Config — อ่านค่าจาก environment variables
   ทุกค่ามี default ปลอดภัย ไม่ต้องมี .env ก็รัน test ได้
   ห้ามใส่ secret ในไฟล์นี้
   ============================================================ */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// อ่าน .env แบบเรียบง่าย (เพื่อไม่พึ่งพา dependency เพิ่มใน Phase 2)
// รองรับ KEY=value, ข้ามบรรทัดว่าง/comment (#)
function loadDotEnv() {
  const envPath = join(__dirname, "..", "..", ".env");
  let raw = "";
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return; // ไม่มี .env ก็ไม่เป็นไร ใช้ default
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // ถอด quote ถ้ามี
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadDotEnv();

function num(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key, fallback = false) {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

export const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
  },
  pexels: {
    apiKey: process.env.PEXELS_API_KEY || "",
    // timeout + retry สำหรับ Pexels API (Phase 4)
    timeoutMs: num("PEXELS_HTTP_TIMEOUT_MS", 15000),
    retries: num("PEXELS_HTTP_RETRIES", 2),
    // delay ระหว่าง keyword เพื่อ rate limit (Pexels free: 200 req/hr)
    delayMs: num("PEXELS_KEYWORD_DELAY_MS", 500),
  },
  storage: {
    databaseUrl: process.env.DATABASE_URL || "file:./data/news.db",
    dataDir: join(__dirname, "..", "..", "data"),
    logsDir: join(__dirname, "..", "..", "logs"),
  },
  scheduler: {
    intervalMinutes: num("NEWS_INTERVAL_MINUTES", 60),
    enabled: bool("SCHEDULER_ENABLED", false),
    runOnStart: bool("RUN_ON_START", false),
    autoPublish: bool("AUTO_PUBLISH", false),
    maxPerRun: num("NEWS_MAX_PER_RUN", 5),
    // Phase 8: จำนวนข่าวล่าสุดที่จะเลือกจาก Kitco ตาม sourcePublishedAt
    // ค่า default 3 ตรงกับโครง "ข่าวล่าสุด" บนเว็บไซต์
    latestCount: num("NEWS_LATEST_COUNT", 3),
  },
  server: {
    host: process.env.SERVER_HOST || "127.0.0.1",
    port: num("PORT", 3000),
    siteVersion: String(process.env.SITE_VERSION || "2") === "1" ? "1" : "2",
    adminToken: process.env.ADMIN_TOKEN || "",
    // Phase 10 — CSRF/Origin protection: allowlist สำหรับ admin state-changing endpoints
    // default ว่าง = ใช้ host ของ server เอง (Origin ต้องตรงกับ req.headers.host)
    // ตั้งเป็น comma-separated origins เช่น "http://127.0.0.1:3000,https://app.example.com"
    adminAllowedOrigins: (process.env.ADMIN_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  // Phase 9 — Auto Pilot: ค่าเริ่มต้นปิดทุกอย่าง (safety)
  // ต้องมี env allowed AND database enabled ทั้งคู่จึงจะรันจริง
  autoPilot: {
    enabled: bool("AUTO_PILOT_ENABLED", false),
    intervalMinutes: num("AUTO_PILOT_INTERVAL_MINUTES", 60),
    maxPerRun: num("AUTO_PILOT_MAX_PER_RUN", 3),
  },
  scraper: {
    maxPerSection: num("KITCO_MAX_PER_SECTION", 20),
    articleDelayMs: num("KITCO_ARTICLE_DELAY_MS", 1500),
    httpTimeoutMs: num("KITCO_HTTP_TIMEOUT_MS", 20000),
    httpRetries: num("KITCO_HTTP_RETRIES", 2),
    // อายุข่าวสูงสุดที่จะรับ (ชั่วโมง) — ข่าวเก่ากว่านี้ถูกตัดออก
    maxAgeHours: num("KITCO_MAX_AGE_HOURS", 48),
  },
  // Phase 12 — Economic Calendar (Forex Factory)
  // กฎ QC: เรียก source ฝั่ง backend เท่านั้น ไม่ให้ frontend scrape เอง
  // - calendarUrl: JSON export สาธารณะของ Forex Factory (thisweek)
  //   เป็น public data เข้าถึงตามปกติ ไม่ใช่ bypass ระบบป้องกันใดๆ
  // - syncIntervalSeconds: ค่าเริ่มต้น 300 (5 นาที) ตามที่ Codex กำหนด
  // - staleAfterSeconds: หาก cache เก่ากว่านี้และ source ล้มเหลว → ยังคืน cache แต่ติด stale=true
  calendar: {
    enabled: bool("CALENDAR_ENABLED", true),
    calendarUrl:
      process.env.FOREX_FACTORY_CALENDAR_URL ||
      "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    sourceName: process.env.CALENDAR_SOURCE_NAME || "Forex Factory",
    syncIntervalSeconds: num("CALENDAR_SYNC_INTERVAL_SECONDS", 300),
    staleAfterSeconds: num("CALENDAR_STALE_AFTER_SECONDS", 1800),
    httpTimeoutMs: num("CALENDAR_HTTP_TIMEOUT_MS", 15000),
    httpRetries: num("CALENDAR_HTTP_RETRIES", 2),
    // อายุ event สูงสุดที่จะเก็บใน cache (ชั่วโมง) — เก่ากว่านี้ถูก prune
    maxEventAgeHours: num("CALENDAR_MAX_EVENT_AGE_HOURS", 168),
  },
  // Phase 13 — Market Ticker (watchlist prices)
  // กฎ QC (ตามที่ Codex กำหนด):
  // - ดึงข้อมูลฝั่ง backend เท่านั้น ห้ามให้ browser เรียก third-party โดยตรง
  // - cacheSeconds ≥ 30 (กัน hammer แหล่งข้อมูล ตาม requirement)
  // - staleAfterSeconds: หาก cache เก่ากว่านี้และ source ล้มเหลว → ยังคืน cache แต่ติด stale=true
  // - ไม่มี secret/API key ใดๆ (ใช้ free public sources เท่านั้น)
  market: {
    enabled: bool("MARKET_ENABLED", true),
    cacheSeconds: num("MARKET_CACHE_SECONDS", 60),
    staleAfterSeconds: num("MARKET_STALE_AFTER_SECONDS", 600),
    syncIntervalSeconds: num("MARKET_SYNC_INTERVAL_SECONDS", 60),
    fetchTimeoutMs: num("MARKET_FETCH_TIMEOUT_MS", 8000),
    // symbols: comma-separated เช่น "XAUUSD,XAGUSD,EURUSD"
    // ค่าเริ่มต้นว่าง = ใช้ DEFAULT_SYMBOLS ของ service
    symbols: (process.env.MARKET_SYMBOLS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  log: {
    level: process.env.LOG_LEVEL || "info",
  },
};
