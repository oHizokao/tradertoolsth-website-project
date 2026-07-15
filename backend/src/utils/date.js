/* ============================================================
   Date helpers — สำหรับอ่าน + เทียบอายุข่าว Kitco
   ------------------------------------------------------------
   Kitco ส่งวันที่ในรูป ISO แบบ offset ไม่มีโคลอน
   เช่น "2026-07-14T09:00:12-0400"
   (ซึ่ง Date ของ JS ยัง parse ได้ แต่กันไว้ดีกว่าแก้)
   ============================================================ */

/**
 * แปลงวันที่ Kitco เป็น Date object
 * @returns {Date|null} null ถ้าอ่านไม่ได้
 */
export function parseKitcoDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
  let s = String(raw).trim();
  if (!s) return null;

  // แก้รูป ISO offset ไม่มีโคลอน: -0400 -> -04:00, +0700 -> +07:00
  // รองรับทั้งมี Z และไม่มี
  s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  // ถ้าลงท้ายด้วย Z ให้ปล่อยผ่าน

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * ตรวจอายุข่าวว่าเก่าเกิน maxAgeHours หรือไม่
 *
 * @param {string|Date} publishedAt
 * @param {number} maxAgeHours
 * @returns {{ ok: boolean, ageHours: number|null, reason: 'fresh'|'aged_out'|'unreadable_date' }}
 *   - ok=true  → ข่าวใหม่พอ (fresh)
 *   - ok=false → ข่าวเก่าเกินไป (aged_out) หรืออ่านวันที่ไม่ได้ (unreadable_date)
 *
 * กฎ: หากอ่านวันที่ไม่ได้ → ถือว่าไม่ ok (ให้ caller เปลี่ยนสถานะ needs_review หรือข้าม)
 */
export function checkAge(publishedAt, maxAgeHours) {
  const d = parseKitcoDate(publishedAt);
  if (!d) {
    return { ok: false, ageHours: null, reason: "unreadable_date" };
  }
  const ageMs = Date.now() - d.getTime();
  const ageHours = ageMs / 3_600_000;
  if (ageHours > maxAgeHours) {
    return { ok: false, ageHours, reason: "aged_out" };
  }
  // กรณีวันที่เป็นอนาคต (clock skew / ทดสอบ) ให้ถือว่า fresh
  return { ok: true, ageHours, reason: "fresh" };
}

/* ============================================================
   Phase 8 — sourcePublishedAt helpers
   ------------------------------------------------------------
   กฎสำคัญ (QC):
   - เวลาเผยแพร่จริงจากต้นทาง (Kitco) ต้องเก็บเป็น sourcePublishedAt
   - ห้ามเดาเวลา หาก parse ไม่ได้ให้คืน null (caller ส่งข่าวไป needs_review)
   - เก็บในฐานข้อมูลเป็น ISO 8601 UTC ที่มี timezone ชัดเจน (suffix Z)
   - แปลงเป็น Asia/Bangkok เฉพาะตอนแสดงผล
   ============================================================ */

// ชื่อ field ที่อาจเก็บเวลาเผยแพร่จริงในข้อมูลต้นทาง
// เรียงตามลำดับความน่าเชื่อถือ (createdAt เป็น field หลักที่ Kitco __NEXT_DATA__ ใช้)
const SOURCE_DATE_FIELDS = [
  "createdAt",
  "publishedAt",
  "datePublished",
  "publishDate",
  "timestamp",
];

/**
 * อ่านค่าเวลาเผยแพร่จริงจาก raw object ของต้นทาง
 * ตรวจ field ที่มีอยู่จริงหลายชื่อ (ตามข้อกำหนด QC)
 *
 * @param {object} raw ข้อมูลดิบจาก Kitco __NEXT_DATA__
 * @returns {string|null} ค่าดิบ (string) ที่พบ หรือ null ถ้าไม่มี field ใดเลย
 *   (ไม่ parse ตรงนี้ — caller ใช้ toUtcIso เพื่อ parse + normalize)
 */
export function extractSourcePublishedAt(raw) {
  if (!raw || typeof raw !== "object") return null;
  for (const key of SOURCE_DATE_FIELDS) {
    const v = raw[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return null;
}

/**
 * แปลงค่าเวลา (หลายรูปแบบ) เป็น ISO 8601 UTC ที่มี timezone ชัดเจน
 * เช่น "2026-07-15T09:59:00-0400" → "2026-07-15T13:59:00.000Z"
 *
 * กฎ: หาก parse ไม่ได้ → คืน null (ห้ามเดา ห้าม fallback)
 *
 * @param {string|Date|null|undefined} value
 * @returns {string|null} ISO UTC string (suffix Z) หรือ null
 */
export function toUtcIso(value) {
  const d = parseKitcoDate(value);
  if (!d) return null;
  return d.toISOString(); // เสมอ UTC + Z เช่น 2026-07-15T13:59:00.000Z
}

// เดือนย่อภาษาไทย (ตรงกับ toLocaleDateString('th-TH', {month:'short'}) สำหรับเดือนเต็ม)
const TH_SHORT_MONTH = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/**
 * แปลง ISO (UTC) เป็นเวลา Asia/Bangkok สำหรับแสดงผล
 * รูปแบบ: "เผยแพร่เมื่อ 15 ก.ค. 2026 20:59 น."
 *
 * @param {string|null|undefined} iso
 * @param {object} [opts] { prefix?: string, timeOnly?: boolean }
 * @returns {string} ข้อความเวลาภาษาไทย หรือ "-" ถ้า iso ไม่ valid
 */
export function toBangkokString(iso, opts = {}) {
  const d = parseKitcoDate(iso);
  if (!d) return "-";
  // แปลงเป็นเวลา Asia/Bangkok (UTC+7) — ไม่พึ่งพา timezone เครื่องรัน
  const bangkokMs = d.getTime() + 7 * 3_600_000;
  const dt = new Date(bangkokMs);
  const day = String(dt.getUTCDate()).padStart(2, "0");
  const month = TH_SHORT_MONTH[dt.getUTCMonth()];
  const year = dt.getUTCFullYear();
  const hh = String(dt.getUTCHours()).padStart(2, "0");
  const mm = String(dt.getUTCMinutes()).padStart(2, "0");
  const timePart = `${hh}:${mm} น.`;
  if (opts.timeOnly) return timePart;
  const datePart = `${day} ${month} ${year} ${timePart}`;
  const prefix = opts.prefix != null ? opts.prefix : "เผยแพร่เมื่อ ";
  return `${prefix}${datePart}`;
}

export { SOURCE_DATE_FIELDS };
