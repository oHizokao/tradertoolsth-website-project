/* ============================================================
   Forex Factory Scraper — Economic Calendar
   ------------------------------------------------------------
   แหล่งข้อมูล: Forex Factory public JSON export
     https://nfs.faireconomy.media/ff_calendar_thisweek.json
   (ข้อมูลสาธารณะที่เข้าถึงได้ตามปกติ ไม่ใช่การ bypass
    CAPTCHA / Cloudflare / login / robots / ระบบป้องกันใดๆ)

   กฎ QC (ตามที่ Codex กำหนด):
   - ดึงข้อมูลฝั่ง backend เท่านั้น ห้ามให้ frontend scrape เอง
   - ใช้ JSON export ที่เสถียรกว่า parse HTML
   - แปลง impact เป็น low / medium / high
   - เก็บเวลาเป็น UTC ใน database; แสดง Asia/Bangkok ที่ frontend
   - รองรับ event ที่ยังไม่มี Actual + tentative time
   - ใช้ deterministic hash เป็น sourceEventId ป้องกันข้อมูลซ้ำ
   - normalize field ทุกตัวให้ครบตาม schema ของระบบ
   ============================================================ */

import { createHash } from "node:crypto";
import { getText } from "../utils/httpClient.js";
import { logger } from "../utils/logger.js";

const log = logger.make("ff-scraper");

export const SOURCE_NAME = "Forex Factory";
export const SOURCE_URL = "https://www.forexfactory.com/calendar/";

/**
 * แปลง impact ของ Forex Factory ("Low"/"Medium"/"High"/"Holiday"/"Non-Economic")
 * เป็นค่ามาตรฐานของระบบ: "low" / "medium" / "high"
 * - "Holiday" / "Non-Economic" ถูกจัดเป็น "low" (ไม่ใช่ market-moving)
 *
 * @param {string} raw
 * @returns {"low"|"medium"|"high"}
 */
export function normalizeImpact(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "high") return "high";
  if (v === "medium") return "medium";
  // low, holiday, non-economic, ค่าว่าง และค่าอื่นๆ → low
  return "low";
}

/**
 * แปลงค่า "actual/forecast/previous" ของ FF (string หรือ "")
 * - "" หรือ null → null (ยังไม่มีข้อมูล)
 * - อย่างอื่น → เก็บเป็น string ที่ trimmed
 *
 * @param {string} v
 * @returns {string|null}
 */
function normalizeValue(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * สร้าง deterministic sourceEventId จาก (date + title + currency)
 * ใช้เพื่อตรวจข้อมูลซ้ำและอัปเดต record เดิมเมื่อมี Actual ใหม่
 *
 * กฎ: ใช้คีย์ที่เสถียร (UTC time + title + currency) ทั้งก่อน/หลัง
 * อัปเดต Actual เพื่อให้ sourceEventId คงที่
 *
 * @param {object} parts { dateUtc, title, currency }
 * @returns {string} "ff-<hash16>"
 */
export function makeSourceEventId({ dateUtc, title, currency }) {
  const key = [dateUtc || "", String(title || "").trim(), String(currency || "").trim().toUpperCase()]
    .join("|");
  const hash = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 16);
  return "ff-" + hash;
}

/**
 * ตรวจว่า event น่าจะเป็น tentative (ยังไม่มีเวลาที่แน่นอน)
 * Forex Factory export บางครั้งใช้คำว่า "Tentative" ใน title หรือ
 * เวลา "All Day" / "00:00" สำหรับ holiday
 *
 * @param {object} ev raw FF event
 * @returns {boolean}
 */
function detectTentative(ev) {
  const title = String(ev.title || "").toLowerCase();
  if (/\btentative\b/.test(title)) return true;
  // Holiday / Daylight มักไม่มีเวลาที่แม่นยำ
  if (/\bholiday\b/.test(String(ev.impact || "").toLowerCase())) return true;
  return false;
}

/**
 * Normalize raw FF event → normalized event object ตาม schema ของระบบ
 *
 * Fields ที่ออกมาครบทุกตัวที่ Codex กำหนด:
 *   sourceEventId, sourceName, sourceUrl, eventName, country, currency,
 *   impact, scheduledAtUtc, scheduledAtBangkok, actual, forecast, previous,
 *   revised, detailUrl, lastUpdated, isTentative
 *
 * @param {object} ev raw FF event { title, country, date, impact, forecast, previous }
 * @param {object} [meta] { sourceName, sourceUrl }
 * @returns {object|null} null ถ้า date parse ไม่ได้ (ห้ามเดาเวลา)
 */
export function normalizeEvent(ev, meta = {}) {
  if (!ev || typeof ev !== "object") return null;

  const title = String(ev.title || "").trim();
  const currency = String(ev.country || "").trim().toUpperCase();
  const rawDate = ev.date;

  // แปลง date → UTC ISO (FF export ส่ง ISO พร้อม offset เช่น -04:00)
  let dateUtc = null;
  if (rawDate) {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      dateUtc = d.toISOString(); // UTC + Z
    }
  }
  // กฎ QC: หาก parse date ไม่ได้ → ทิ้ง event (ห้ามเดาเวลา)
  if (!dateUtc) return null;

  const scheduledAtBangkok = toBangkokIso(dateUtc);
  const impact = normalizeImpact(ev.impact);
  const sourceName = meta.sourceName || SOURCE_NAME;
  const sourceUrl = meta.sourceUrl || SOURCE_URL;

  return {
    sourceEventId: makeSourceEventId({ dateUtc, title, currency }),
    sourceName,
    sourceUrl,
    eventName: title,
    country: currency, // FF export ใช้ country เป็นรหัสสกุลเงิน (USD/EUR/...)
    currency,
    impact,
    scheduledAtUtc: dateUtc,
    scheduledAtBangkok,
    actual: normalizeValue(ev.actual),
    forecast: normalizeValue(ev.forecast),
    previous: normalizeValue(ev.previous),
    revised: normalizeValue(ev.revised),
    detailUrl: ev.detailUrl || null,
    lastUpdated: new Date().toISOString(),
    isTentative: detectTentative(ev),
  };
}

/**
 * แปลง UTC ISO → Asia/Bangkok ISO (UTC+7) โดยไม่พึ่ง timezone เครื่องรัน
 * ใช้สำหรับ query ช่วงเวลา "วันนี้/พรุ่งนี้/สัปดาห์นี้" ในมุมมองเวลาไทย
 *
 * @param {string} isoUtc
 * @returns {string} ISO string ที่เลื่อน +7 ชม.
 */
function toBangkokIso(isoUtc) {
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 3_600_000).toISOString();
}

/**
 * Parse raw JSON text → normalized events array
 * - validate เป็น array ของ object
 * - ข้าม entry ที่ normalize ไม่ได้ (เช่น date ไม่ valid)
 *
 * @param {string} jsonText
 * @param {object} [meta]
 * @returns {object[]}
 */
export function parseCalendarJson(jsonText, meta = {}) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`invalid JSON from Forex Factory export: ${err.message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error(
      `Forex Factory export is not an array (got ${typeof data})`
    );
  }
  const out = [];
  let skipped = 0;
  for (const raw of data) {
    const ev = normalizeEvent(raw, meta);
    if (ev) out.push(ev);
    else skipped++;
  }
  if (skipped > 0) {
    log.warn(`parseCalendarJson: skipped ${skipped} events (invalid date/data)`);
  }
  return out;
}

/**
 * ดึงและ normalize calendar จาก Forex Factory JSON export
 * - ใช้ getText (มี timeout + retry + rate-limit backoff อยู่แล้ว)
 * - ส่งคืน array ของ normalized events
 *
 * @param {object} [opts] { url, sourceName, sourceUrl, timeoutMs, retries }
 * @returns {Promise<object[]>}
 */
export async function fetchCalendar(opts = {}) {
  const url = opts.url || SOURCE_EXPORT_URL;
  const meta = {
    sourceName: opts.sourceName || SOURCE_NAME,
    sourceUrl: opts.sourceUrl || SOURCE_URL,
  };
  const text = await getText(url, {
    accept: "application/json,text/json",
    timeoutMs: opts.timeoutMs,
    retries: opts.retries,
  });
  const events = parseCalendarJson(text, meta);
  log.info(
    `fetched ${events.length} events from ${url} (${text.length} bytes)`
  );
  return events;
}

// Default export URL (อาจ override ผ่าน opts.url / env)
export const SOURCE_EXPORT_URL =
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
