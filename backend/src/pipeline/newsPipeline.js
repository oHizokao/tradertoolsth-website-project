/* ============================================================
   News Pipeline (Phase 5) — orchestrate ข่าว 1 รายการผ่าน
   dedup → AI → image gate → save (transaction)
   ------------------------------------------------------------
   กฎ QC ที่บังคับ:
   - dedup check + insert ใน transaction เดียวกัน (กัน race)
   - validationStatus แยกจาก publishStatus ตลอด (Phase 5 ไม่ publish อัตโนมัติ)
   - image pipeline เรียกเฉพาะ validationStatus=validated|needs_review
     REJECTED/FAILED/skipped → ข้าม image, image fields = null (ไม่เสีย Pexels quota)
   - ห้ามเรียก Pexels ซ้ำถ้ามี image metadata ที่ใช้ได้แล้ว
   - image status/reviewRequired ต้องไม่เปลี่ยน validationStatus/publishStatus
   - ห้ามส่ง external source เข้า OpenAI (source policy gate ใน AI pipeline แล้ว)
   ============================================================ */

import { logger } from "../utils/logger.js";
import { processNews } from "../ai/pipeline.js";
import { findImageForNews } from "../image/imagePipeline.js";
import { NewsStatus } from "../utils/schema.js";

const log = logger.make("news-pipeline");

// validationStatus ที่ควรค้นรูป (ตามกฎ QC)
const IMAGE_ELIGIBLE_STATUS = new Set([
  NewsStatus.VALIDATED,
  NewsStatus.NEEDS_REVIEW,
]);

/**
 * ประมวลผลข่าว 1 รายการ end-to-end: dedup → AI → image → save
 *
 * @param {object} news ข่าว (จาก scraper.fetchArticle) ต้องมี id/source/sourceUrl/...
 * @param {object} ctx { repo, db } — repository + db instance
 * @param {object} opts { aiOpts, imageOpts, skipImage }
 *   - aiOpts: ส่งต่อให้ processNews (forceMock/requireReal/_testRewriteResponse/...)
 *   - imageOpts: ส่งต่อให้ findImageForNews (_mockSearchFn/delayMs)
 *   - skipImage: บังคับข้าม image (สำหรับ test)
 * @returns {Promise<object>} { ok, reason, saved, duplicate, imageSkipped, news, error? }
 */
export async function processAndSaveNews(news, ctx, opts = {}) {
  const { repo } = ctx;
  if (!repo) throw new Error("processAndSaveNews ต้องการ ctx.repo (newsRepository)");

  // Avoid AI and image API work for an item that is already stored.
  // saveWithDedup repeats this check inside the insert transaction.
  const existing = repo.findDuplicate(news);
  if (existing.isDuplicate) {
    return {
      ok: true,
      reason: "duplicate",
      saved: false,
      duplicate: true,
      duplicateReason: existing.reason,
      imageSkipped: true,
      imageStatus: null,
      news,
    };
  }

  // ---- 1) AI pipeline (source policy + rewrite + validate) ----
  // ภายในมี source policy gate → external source จะไม่ส่งเข้า OpenAI
  const aiResult = await processNews(news, opts.aiOpts || {});
  const processed = aiResult.news; // มี validationStatus แยก publishStatus แล้ว
  const validationStatus = processed.validationStatus;

  // ---- 2) Image gate ----
  // เรียกเฉพาะ validationStatus=validated|needs_review
  let imageSkipped = true;
  let imageResult = null;
  if (
    !opts.skipImage &&
    aiResult.skipped !== true &&
    IMAGE_ELIGIBLE_STATUS.has(validationStatus)
  ) {
    // ข้ามถ้ามี image metadata ที่ใช้ได้แล้ว (กันเรียก Pexels ซ้ำ)
    if (processed.imageUrl) {
      log.debug(`news ${processed.id} มี imageUrl แล้ว — ข้าม Pexels`);
      imageSkipped = true;
    } else {
      imageSkipped = false;
      try {
        imageResult = await findImageForNews(processed, opts.imageOpts || {});
        // merge image metadata เข้า news (ไม่แต่ validation/publish status)
        processed.imageUrl = imageResult.imageUrl || "";
        processed.imageSource = imageResult.imageSource || "Pexels";
        processed.imageAuthor = imageResult.imageAuthor || "";
        processed.imageAuthorUrl = imageResult.imageAuthorUrl || "https://www.pexels.com";
        processed.imageLicense = imageResult.imageLicense || "Pexels License";
        processed.imageSourceUrl = imageResult.imageSourceUrl || "https://www.pexels.com";
        processed.imageSearchKeywords = imageResult.imageSearchKeywords || [];
        processed.imageStatus = imageResult.status; // selected/fallback/failed
        processed.imageReviewRequired = !!imageResult.reviewRequired;
        log.info(
          `image: status=${imageResult.status} reviewRequired=${imageResult.reviewRequired} | ${processed.id}`
        );
      } catch (err) {
        // image ล้มเหลวไม่ทำให้ทั้ง news fail — เก็บ fallback + ไม่แต่ status
        log.warn(`image failed (non-fatal): ${err.message} | ${processed.id}`);
        processed.imageStatus = "failed";
        processed.imageReviewRequired = true;
      }
    }
  } else {
    // REJECTED/FAILED/skipped/source-policy-block → image fields ว่าง, ไม่เรียก Pexels
    processed.imageUrl = null;
    processed.imageSource = null;
    processed.imageAuthor = null;
    processed.imageAuthorUrl = null;
    processed.imageLicense = null;
    processed.imageSourceUrl = null;
    processed.imageStatus = null;
    processed.imageReviewRequired = false;
  }

  const now = new Date().toISOString();
  processed.validatedAt =
    validationStatus === NewsStatus.VALIDATED
      ? processed.validatedAt || now
      : null;
  processed.publishedAt = processed.publishedAt || null;
  processed.updatedAt = now;

  // ---- 3) Save (dedup + insert ใน transaction เดียวกัน) ----
  let saveResult;
  try {
    saveResult = repo.saveWithDedup(processed);
  } catch (err) {
    log.error(`save failed: ${err.message} | ${processed.id}`);
    return {
      ok: false,
      reason: "save_failed",
      saved: false,
      duplicate: false,
      imageSkipped,
      news: processed,
      error: err.message,
    };
  }

  log.info(
    `processAndSave: id=${processed.id} validation=${validationStatus} publish=${processed.publishStatus} ` +
      `saved=${saveResult.saved} duplicate=${saveResult.duplicate} imageSkipped=${imageSkipped}`
  );

  return {
    ok: true,
    reason: aiResult.reason,
    saved: saveResult.saved,
    duplicate: saveResult.duplicate,
    duplicateReason: saveResult.reason || null,
    imageSkipped,
    imageStatus: processed.imageStatus,
    news: processed,
  };
}

/**
 * ประมวลผล batch ข่าว (sequential, rate-limit friendly)
 * @returns { results, saved, duplicates, failed }
 */
export async function processAndSaveBatch(newsList, ctx, opts = {}) {
  const results = [];
  const buckets = { saved: [], duplicates: [], failed: [] };
  for (const news of newsList) {
    try {
      const r = await processAndSaveNews(news, ctx, opts);
      results.push(r);
      if (r.duplicate) buckets.duplicates.push(r);
      else if (r.saved) buckets.saved.push(r);
      else buckets.failed.push(r);
    } catch (err) {
      buckets.failed.push({ ok: false, error: err.message, news });
      log.error(`batch item failed: ${err.message}`);
    }
  }
  return { results, ...buckets };
}

export { IMAGE_ELIGIBLE_STATUS };
