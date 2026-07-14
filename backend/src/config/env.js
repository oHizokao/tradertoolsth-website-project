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
  },
  server: {
    host: process.env.SERVER_HOST || "127.0.0.1",
    port: num("PORT", 3000),
    siteVersion: String(process.env.SITE_VERSION || "2") === "1" ? "1" : "2",
    adminToken: process.env.ADMIN_TOKEN || "",
  },
  scraper: {
    maxPerSection: num("KITCO_MAX_PER_SECTION", 20),
    articleDelayMs: num("KITCO_ARTICLE_DELAY_MS", 1500),
    httpTimeoutMs: num("KITCO_HTTP_TIMEOUT_MS", 20000),
    httpRetries: num("KITCO_HTTP_RETRIES", 2),
    // อายุข่าวสูงสุดที่จะรับ (ชั่วโมง) — ข่าวเก่ากว่านี้ถูกตัดออก
    maxAgeHours: num("KITCO_MAX_AGE_HOURS", 48),
  },
  log: {
    level: process.env.LOG_LEVEL || "info",
  },
};
