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
