/* ============================================================
   Image Ranking — ตรวจความเหมาะสมทางเตคนิค (Technical Suitability)
   ------------------------------------------------------------
   เกณฑ์:
   - ต้องแนวนอน (landscape): width >= height
   - ความละเอียดขั้นต่ำ: width >= MIN_WIDTH
   - Score จาก: landscape bonus + resolution + aspect ratio

   สิ่งที่ scorePhoto วัด (เทคนิคเท่านั้น):
     1. แนวนอน (landscape) — เหมาะสำหรับ web layout
     2. ความละเอียด (resolution) — ความชัดเจนเพียงพอ
     3. Aspect ratio — ใกล้ 16:9 หรือ 4:3 เหมาะ display standard

   สิ่งที่ scorePhoto ไม่วัด (ไม่ใช่ semantic relevance):
   - ไม่วัดว่ารูปเกี่ยวกับเนื้อข่าวแค่ไหน
   - Keyword ที่ใช้ค้นหาเป็น search signal เท่านั้น ไม่หมายความว่า Pexels เข้าใจเนื้อหา
   - Pexels เป็น image search engine ไม่ใช่ news-aware system

   ข้อจำกัด:
   - ห้ามดาวน์โหลดหรือเก็บไฟล์รูป เก็บเฉพาะ URL + metadata
   ============================================================ */

// เกณฑ์ขั้นต่ำ
const MIN_WIDTH = 800; // pixel

// เกณฑ์ score เพื่อตัดสิน reviewRequired
// รูปที่ผ่าน threshold ถือว่า "ใช้ได้" (reviewRequired=false)
// รูปที่ต่ำกว่า threshold ยังใช้ได้แต่ต้องตรวจ (reviewRequired=true)
export const SCORE_THRESHOLD = 60;

/**
 * คำนวณ score ความเหมาะสมทางเตคนิค (technical suitability) ของรูป
 * วัด 3 สิ่ง:
 *   1. Orientation  — landscape (+50) หรือ portrait/square (0 ตัดผ่าน)
 *   2. Resolution   — ความชัดเจนในแนวนอน (+0..+20)
 *   3. Aspect ratio — ใกล้ 16:9 หรือ 4:3 เหมาะ web standard (+0..+15)
 *
 * หมายเหตุ: นี่คือ technical suitability ไม่ใช่ semantic relevance
 *   - ไม่วัดว่ารูปเกี่ยวกับเนื้อข่าว
 *   - keyword ที่ใช้ค้นหาเป็นเพียง search signal ไม่ใช่การยืนยัน content match
 */
export function scorePhoto(photo) {
  let score = 0;
  const w = photo.width || 0;
  const h = photo.height || 1;

  // ต้องแนวนอน (landscape)
  if (w < h) return 0; // portrait → ตัดออกเลย
  if (w < MIN_WIDTH) return 0; // ความละเอียดต่ำเกิน

  // landscape bonus
  score += 50;

  // resolution bonus: proportional to width (สูงสุด 20)
  score += Math.min(Math.floor(w / 100), 20);

  // aspect ratio bonus (16:9 = 1.778, 4:3 = 1.333)
  const ratio = w / h;
  const diff169 = Math.abs(ratio - 16 / 9);
  const diff43 = Math.abs(ratio - 4 / 3);
  const bestDiff = Math.min(diff169, diff43);
  if (bestDiff < 0.1) score += 15;
  else if (bestDiff < 0.3) score += 8;
  else if (bestDiff < 0.6) score += 3;

  return score;
}

/**
 * Deduplicate รูปโดยใช้ photo.id
 * ป้องกันรูปซ้ำจากหลาย keyword
 *
 * @param {object[]} photos รายการรูปอาจมีซ้ำ
 * @returns {object[]} รูปไม่ซ้ำ รักษาลำดับแรกที่พบ
 */
export function deduplicatePhotos(photos) {
  const seen = new Set();
  return photos.filter((p) => {
    if (!p || !p.id) return false;
    const key = String(p.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * กรองและจัดอันดับรูปจาก Pexels
 *
 * @param {object[]} photos รายการรูปจาก Pexels (อาจมีซ้ำจากหลาย keyword)
 * @returns {Array<{ photo: object, score: number }>} เรียงตาม score สูงสุดก่อน
 *   เฉพาะรูปที่ผ่านเกณฑ์ขั้นต่ำ (landscape + MIN_WIDTH)
 */
export function rankPhotos(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return [];

  // deduplicate ก่อนจัดอันดับ
  const unique = deduplicatePhotos(photos);

  const scored = unique
    .map((photo) => ({ photo, score: scorePhoto(photo) }))
    .filter((item) => item.score > 0); // ตัด portrait + ความละเอียดต่ำออก

  // เรียงจากสูงไปต่ำ
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * เลือกรูปที่ดีที่สุดจาก ranked list
 * คืน { photo, score, reviewRequired }
 *   - reviewRequired=false ถ้า score >= SCORE_THRESHOLD
 *   - reviewRequired=true  ถ้า score < SCORE_THRESHOLD
 *
 * @param {Array<{photo, score}>} ranked ผลจาก rankPhotos()
 * @returns {{ photo: object, score: number, reviewRequired: boolean } | null}
 */
export function selectBestPhoto(ranked) {
  if (!ranked || ranked.length === 0) return null;
  const best = ranked[0];
  return {
    photo: best.photo,
    score: best.score,
    reviewRequired: best.score < SCORE_THRESHOLD,
  };
}

// export สำหรับ test
export const __MIN_WIDTH = MIN_WIDTH;
