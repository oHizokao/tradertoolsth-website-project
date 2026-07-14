/* ============================================================
   Duplicate Detection
   ตรวจข่าวซ้ำ 5 ชั้นตามที่กำหนด:
     1. sourceUrl / urlAlias เดียวกัน
     2. duplicateHash เดียวกัน
     3. ชื่อข่าวเหมือนกันเป๊ะ
     4. ชื่อข่าวคล้ายกันมาก (similarity >= threshold)
     5. (ชั้นที่ 5: เหตุการณ์เดียวกันช่วงใกล้กัน → ใช้ใน Phase 3+ เมื่อมี AI)
   ============================================================ */

import {
  duplicateHash,
  normalizeText,
  normalizeUrlAlias,
  titleSimilarity,
} from "../utils/hash.js";

// ค่าเริ่มต้น: ชื่อคล้ายกัน >= 0.7 ถือว่าซ้ำ
const DEFAULT_TITLE_THRESHOLD = 0.7;

/**
 * สร้าง index จากรายการข่าวที่มีอยู่ เพื่อเทียบรอบเดียว (O(n))
 * ใช้ทั้งใน store/ และ CLI test
 */
export function buildIndex(existingNews) {
  const byUrl = new Map();
  const byHash = new Map();
  const byTitle = new Map();
  const list = []; // [{title, url, hash}] สำหรับ similarity scan

  for (const n of existingNews || []) {
    // Phase 5: sourceUrl/originalTitle เป็นมาตรฐาน (urlAlias/title = legacy fallback)
    const url = normalizeUrlAlias(n.sourceUrl || n.urlAlias);
    const hash =
      n.duplicateHash ||
      duplicateHash({ sourceUrl: n.sourceUrl, originalTitle: n.originalTitle });
    const title = normalizeText(n.originalTitle || n.title);
    if (url) byUrl.set(url, n.id ?? url);
    if (hash) byHash.set(hash, n.id ?? hash);
    if (title) byTitle.set(title, n.id ?? title);
    if (title) list.push({ title, url, hash, id: n.id });
  }
  return { byUrl, byHash, byTitle, list };
}

/**
 * ตรวจข่าวเดียวกับ index
 * @returns { { isDuplicate: boolean, reason?: string, matchId?: string, similarity?: number } }
 */
export function checkDuplicate(newsItem, index, opts = {}) {
  const threshold = opts.titleThreshold ?? DEFAULT_TITLE_THRESHOLD;
  const url = normalizeUrlAlias(newsItem.sourceUrl || newsItem.urlAlias);
  const hash =
    newsItem.duplicateHash ||
    duplicateHash({
      sourceUrl: newsItem.sourceUrl,
      originalTitle: newsItem.originalTitle,
    });
  const title = normalizeText(newsItem.originalTitle || newsItem.title);

  // 1) URL เดียวกัน
  if (url && index.byUrl.has(url)) {
    return {
      isDuplicate: true,
      reason: "same_url",
      matchId: index.byUrl.get(url),
    };
  }
  // 2) duplicateHash เดียวกัน
  if (hash && index.byHash.has(hash)) {
    return {
      isDuplicate: true,
      reason: "same_hash",
      matchId: index.byHash.get(hash),
    };
  }
  // 3) ชื่อเหมือนกันเป๊ะ
  if (title && index.byTitle.has(title)) {
    return {
      isDuplicate: true,
      reason: "same_title",
      matchId: index.byTitle.get(title),
    };
  }
  // 4) ชื่อคล้ายกันมาก
  let best = { similarity: 0 };
  for (const entry of index.list) {
    const sim = titleSimilarity(title, entry.title);
    if (sim > best.similarity) best = { similarity: sim, matchId: entry.id };
  }
  if (best.similarity >= threshold) {
    return {
      isDuplicate: true,
      reason: "similar_title",
      matchId: best.matchId,
      similarity: best.similarity,
    };
  }

  return { isDuplicate: false, similarity: best.similarity };
}

/**
 * กรอง list ข่าวใหม่ โดยหยุดทันทีเมื่อพบข่าวซ้ำ (ไม่สร้างข่าวใหม่)
 * คืน { accepted, skipped }
 */
export function dedupeList(newItems, existingNews, opts = {}) {
  const index = buildIndex(existingNews);
  const accepted = [];
  const skipped = [];
  for (const item of newItems) {
    const r = checkDuplicate(item, index, opts);
    if (r.isDuplicate) {
      skipped.push({ item, ...r });
    } else {
      accepted.push(item);
      // เพิ่ม item ที่รับเข้า index ทันที เพื่อตรวจซ้ำภายใน batch เดียวกันด้วย
      const url = normalizeUrlAlias(item.sourceUrl || item.urlAlias);
      const hash = item.duplicateHash || duplicateHash(item);
      const title = normalizeText(item.originalTitle || item.title);
      if (url) index.byUrl.set(url, item.id ?? url);
      if (hash) index.byHash.set(hash, item.id ?? hash);
      if (title) index.byTitle.set(title, item.id ?? title);
      if (title) index.list.push({ title, url, hash, id: item.id });
    }
  }
  return { accepted, skipped };
}
