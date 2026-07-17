/* ============================================================
   Image Pipeline — orchestrate การค้นหาและเลือกรูปจาก Pexels
   ------------------------------------------------------------
   ลำดับ:
   1. buildImageKeywords(news) → keyword[]
   2. สำหรับแต่ละ keyword: searchPhotos(keyword) [delay ระหว่าง keyword]
   3. รวม photos จากทุก keyword
   4. deduplicatePhotos (by photo.id)
   5. rankPhotos → selectBestPhoto
   6. mapPhotoToMetadata → คืน metadata + status + reviewRequired

   status:
     selected  — ได้รูปจาก Pexels (score สูงหรือต่ำก็ตาม)
     fallback  — ไม่มี API key หรือ Pexels ไม่มีรูปเลย
     failed    — API ล้มเหลวทุก retry

   reviewRequired (แยกอิสระจาก status):
     false  — status=selected + score >= SCORE_THRESHOLD
     true   — status=selected แต่ score ต่ำ, หรือ fallback, หรือ failed

   ข้อจำกัด:
   - ห้ามส่งเนื้อหาข่าวทั้งหมดไป Pexels (ส่งเฉพาะ keyword สั้น)
   - ห้ามดาวน์โหลดหรือเก็บไฟล์รูป (เก็บเฉพาะ URL + metadata)
   - ไม่อ้างว่า Pexels match เนื้อข่าว 100% (Pexels ไม่เข้าใจเนื้อหา)
   ============================================================ */

import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { buildImageKeywords } from "./keywords.js";
import { searchPhotos, mapPhotoToMetadata, FALLBACK_IMAGE } from "./pexels.client.js";
import {
  deduplicatePhotos,
  rankPhotos,
  selectBestPhoto,
  SCORE_THRESHOLD,
} from "./ranking.js";

const log = logger.make("image-pipeline");

// Image status constants
export const ImageStatus = Object.freeze({
  SELECTED: "selected",
  FALLBACK: "fallback",
  FAILED: "failed",
});

export function makeOwnedPlaceholder(news, keywords = []) {
  const haystack = `${news?.category || ""} ${news?.originalTitle || ""}`.toLowerCase();
  const kind = /gold|silver|bullion|precious|ทอง|เงิน/.test(haystack)
    ? "gold"
    : /fed|econom|inflation|rate|เศรษฐ|ดอกเบี้ย/.test(haystack)
      ? "economy"
      : "market";
  return {
    status: ImageStatus.SELECTED,
    reviewRequired: false,
    imageUrl: `/news-assets/${kind}.svg`,
    imageSource: "TraderToolsTH",
    imageAuthor: "TraderToolsTH Design",
    imageAuthorUrl: "/",
    imageLicense: "Owned artwork",
    imageSourceUrl: `/news-assets/${kind}.svg`,
    imageSearchKeywords: keywords,
  };
}

/**
 * สร้าง metadata สำหรับ fallback (ไม่มีรูปจริง)
 * @param {string[]} keywords keywords ที่พยายามค้นหา
 * @returns {object} metadata พร้อม status + reviewRequired
 */
function makeFallbackResult(keywords = []) {
  return {
    status: ImageStatus.FALLBACK,
    reviewRequired: true,
    ...FALLBACK_IMAGE,
    imageSearchKeywords: keywords,
  };
}

/**
 * ค้นหารูปจาก Pexels สำหรับข่าว 1 รายการ
 *
 * @param {object} news ข่าว (ต้องมี imageSearchKeywords, originalTitle, category)
 * @param {object} opts
 *   - delayMs: หน่วงระหว่าง keyword (default จาก config)
 *   - _mockSearchFn: inject search function สำหรับ test
 *     - ถ้าเป็น function → เรียกแทน searchPhotos จริง
 *     - format: async (query, opts) => photo[]
 * @returns {Promise<object>} {
 *     status, reviewRequired,
 *     imageUrl, imageSource, imageAuthor, imageAuthorUrl,
 *     imageLicense, imageSourceUrl, imageSearchKeywords
 *   }
 */
export async function findImageForNews(news, opts = {}) {
  const delayMs = opts.delayMs ?? config.pexels?.delayMs ?? 500;
  const searchFn = typeof opts._mockSearchFn === "function"
    ? opts._mockSearchFn
    : searchPhotos;

  // ---- 1) สร้าง keywords ----
  const keywords = buildImageKeywords(news);
  log.info(`image search: ${keywords.length} keywords for "${(news.originalTitle || "").slice(0, 60)}"`);

  if (!config.pexels?.apiKey && typeof opts._mockSearchFn !== "function") {
    // QC (requirement ข้อ 2): ห้ามแอบตั้งรูปสำรองเป็น selected แล้วถือว่าพร้อมเผยแพร่
    // เมื่อไม่มี Pexels API key → status=fallback + reviewRequired=true
    // (ไม่ใช่ makeOwnedPlaceholder ที่ตั้ง selected/reviewRequired=false)
    // makeOwnedPlaceholder สงวนไว้สำหรับ admin manual review เท่านั้น (คนเลือกเอง)
    log.info("Pexels key unavailable; using fallback image with reviewRequired=true");
    return makeFallbackResult(keywords);
  }

  // ---- 2) ค้นหาทุก keyword, รวม photos ----
  const allPhotos = [];
  let apiFailedAll = false;
  let allFailed = true; // จะเป็น true เฉพาะเมื่อทุก keyword throw

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    if (i > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      const photos = await searchFn(kw, opts);
      allPhotos.push(...photos);
      allFailed = false; // อย่างน้อย 1 keyword สำเร็จ
      log.debug(`keyword "${kw}" → ${photos.length} photos`);
    } catch (err) {
      log.warn(`keyword "${kw}" failed: ${err.message}`);
      // ถ้าทุก keyword throw จะยังคง allFailed=true
    }
  }

  // ---- 3) ถ้าทุก keyword throw → failed ----
  if (keywords.length > 0 && allFailed) {
    log.error("image pipeline: ทุก keyword ล้มเหลว → status=failed");
    return {
      status: ImageStatus.FAILED,
      reviewRequired: true,
      ...FALLBACK_IMAGE,
      imageSearchKeywords: keywords,
    };
  }

  // ---- 4) Deduplicate + rank ----
  const ranked = rankPhotos(allPhotos); // dedup อยู่ใน rankPhotos แล้ว
  const best = selectBestPhoto(ranked);

  // ---- 5) ไม่มีรูปที่ผ่านเกณฑ์ → fallback ----
  if (!best) {
    log.info("image pipeline: ไม่มีรูปผ่านเกณฑ์ → status=fallback");
    return makeFallbackResult(keywords);
  }

  // ---- 6) ได้รูป → selected ----
  const metadata = mapPhotoToMetadata(best.photo, keywords);
  const result = {
    status: ImageStatus.SELECTED,
    reviewRequired: best.reviewRequired, // false ถ้า score >= SCORE_THRESHOLD
    ...metadata,
  };

  log.info(
    `image selected: score=${best.score} reviewRequired=${best.reviewRequired} url=${result.imageUrl.slice(0, 60)}`
  );
  return result;
}

// export สำหรับ test
export { SCORE_THRESHOLD };
