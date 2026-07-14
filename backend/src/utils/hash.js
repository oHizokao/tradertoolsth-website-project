/* ============================================================
   Hash + Normalization utilities
   ใช้สำหรับ duplicate detection (duplicateHash, title similarity)
   ============================================================ */

import { createHash } from "node:crypto";

/**
 * hash ตัวเดียวสำหรับเนื้อหา ใช้เทียบความซ้ำแบบ exact match
 */
export function sha256(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

/**
 * สร้าง duplicateHash จาก url + title ปกติ
 * (ตัวช่วยเทียบข่าวซ้ำในเบื้องต้น)
 *
 * QC รอบ (Phase 5): รองรับชื่อ field มาตรฐาน `sourceUrl`/`originalTitle`
 * พร้อม backward-compat `urlAlias`/`title` (ระบบเดิม)
 */
export function duplicateHash({ sourceUrl, urlAlias, originalTitle, title }) {
  const url = sourceUrl ?? urlAlias;
  const t = originalTitle ?? title;
  const key = [normalizeUrlAlias(url), normalizeText(t)]
    .filter(Boolean)
    .join("|");
  return key ? sha256(key).slice(0, 16) : null;
}

/**
 * ทำให้ URL alias เป็นรูปแบบมาตรฐาน เพื่อเทียบกันได้แม้มี slash/trailing ต่างกัน
 */
export function normalizeUrlAlias(urlAlias) {
  if (!urlAlias) return "";
  return String(urlAlias)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, "") // ตัดโดเมน
    .replace(/\/+/g, "/") // ลด // ซ้อน
    .replace(/\/$/, ""); // ตัด trailing slash
}

/**
 * ทำให้ข้อความเป็นรูปแบบมาตรฐานก่อนเทียบ
 */
export function normalizeText(text) {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ") // เหลือตัวอักษร+ตัวเลขเท่านั้น (รองรับ unicode/ภาษาไทย)
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * เปรียบเทียบชื่อข่าวสองชื่อ คืนค่าความคล้าย 0-1
 * ใช้ token-overlap (Jaccard) แบบง่าย รวดเร็ว ไม่ต้องลง dependency
 */
export function titleSimilarity(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function tokenize(text) {
  const norm = normalizeText(text);
  if (!norm) return [];
  // ภาษาอังกฤษ/ตัวเลข แบ่งด้วย whitespace
  // (ภาษาไทยไม่มีช่องว่าง — เก็บทั้ง chunk เป็น token เดียว ซึ่งเพียงพอสำหรับเทียบชื่อข่าว EN)
  return norm.split(/\s+/).filter((w) => w.length >= 2);
}
