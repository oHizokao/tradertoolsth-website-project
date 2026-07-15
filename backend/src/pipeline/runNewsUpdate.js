import { config } from "../config/env.js";
import { fetchDigest, fetchArticles, selectTopNews } from "../scraper/kitco.scraper.js";
import { processAndSaveBatch } from "./newsPipeline.js";
import { logger } from "../utils/logger.js";
import { createEmptyNews, NewsStatus } from "../utils/schema.js";
import { duplicateHash } from "../utils/hash.js";
import { toUtcIso } from "../utils/date.js";
import { checkAge } from "../utils/date.js";

const log = logger.make("news-update");

/**
 * Phase 9 Safety Gate — ตรวจข่าว 16 ข้อก่อน publish อัตโนมัติ
 *
 * กฎ QC (ห้าม bypass):
 *   - ข่าวจะ publish ได้ต่อเมื่อผ่านทุกข้อ — ข้อใดไม่ผ่าน → reasons ระบุ
 *   - ห้าม publish needs_review/rejected/failed/mock/missing-sourcePublishedAt
 *
 * @param {object} news ข่าวหลัง pipeline (มี validationStatus, imageStatus, ...)
 * @param {object} [opts] { isMockRun?: boolean, maxAgeHours?: number }
 * @returns {{ passed: boolean, reasons: string[] }}
 *   reasons = รายการ gate ที่ไม่ผ่าน (ว่าง = ผ่านทุกข้อ)
 */
export function evaluateSafetyGate(news, opts = {}) {
  const reasons = [];
  if (!news) {
    return { passed: false, reasons: ["no_news_object"] };
  }
  const maxAgeHours = opts.maxAgeHours ?? config.scraper.maxAgeHours;

  // 1) source เป็น Kitco trusted
  if (news.sourcePolicy && news.sourcePolicy !== "trusted") {
    reasons.push(`source_not_trusted:${news.sourcePolicy}`);
  }
  // 2) มี sourceUrl
  if (!news.sourceUrl) reasons.push("missing_source_url");
  // 3) มี sourcePublishedAt ที่ถูกต้อง (parse ได้)
  const spIso = toUtcIso(news.sourcePublishedAt);
  if (!spIso) reasons.push("invalid_or_missing_sourcePublishedAt");
  // 4) duplicate — ตรวจที่ caller (repo.findDuplicate) ก่อนเรียก; ที่นี่ตรวจ flag ถ้ามี
  if (news._isDuplicate) reasons.push("duplicate");
  // 5) rewrite สำเร็จ (มี thaiTitle + thaiContent)
  if (!news.thaiTitle) reasons.push("missing_thai_title");
  if (!Array.isArray(news.thaiContent) || news.thaiContent.length === 0) {
    reasons.push("missing_thai_content");
  }
  // 6) deterministic validator ผ่าน (status !== rejected/failed)
  if (news.validationStatus === "rejected") {
    reasons.push("deterministic_rejected");
  } else if (news.validationStatus === "failed") {
    reasons.push("deterministic_failed");
  }
  // 7) ไม่มี unexpected numbers + 8) ไม่มีคำแนะนำลงทุน/คำต้องห้าม + 9) ไม่มีข้อมูลที่ AI เติม
  //    (ตรวจจาก aiValidation object ที่ pipeline เซ็ต)
  const aiVal = news.aiValidation;
  if (aiVal) {
    if (Array.isArray(aiVal.bannedWordsFound) && aiVal.bannedWordsFound.length > 0) {
      reasons.push("banned_words_found");
    }
    if (aiVal.investmentAdviceFound === true) {
      reasons.push("investment_advice_found");
    }
    if (aiVal.numbersMatch === false) {
      reasons.push("numbers_mismatch");
    }
    if (aiVal.addedInformationFound === true) {
      reasons.push("added_information_found");
    }
  }
  // 10) ไม่ใช่ mock mode
  if (opts.isMockRun === true) reasons.push("mock_mode");
  // 11) validationStatus === 'validated'
  if (news.validationStatus !== "validated") {
    reasons.push(`validationStatus_not_validated:${news.validationStatus || "null"}`);
  }
  // 12) imageStatus === 'selected' (รวม owned_placeholder ที่คืน status='selected')
  if (news.imageStatus !== "selected") {
    reasons.push(`imageStatus_not_selected:${news.imageStatus || "null"}`);
  }
  // 13) imageReviewRequired === false
  if (news.imageReviewRequired === true) reasons.push("image_review_required");
  // 14) publishStatus ยังไม่ใช่ published
  if (news.publishStatus === "published") reasons.push("already_published");
  // 15) อายุข่าว ≤ maxAgeHours (ใช้ sourcePublishedAt เท่านั้น ห้าม fallback)
  if (spIso) {
    const age = checkAge(news.sourcePublishedAt, maxAgeHours);
    if (!age.ok && age.reason !== "unreadable_date") {
      reasons.push(`news_too_old:${Math.round(age.ageHours)}h>${maxAgeHours}h`);
    }
  }
  // 16) มี credit + sourceUrl ครบ
  if (!news.credit) reasons.push("missing_credit");
  if (!news.imageUrl) reasons.push("missing_image_url");
  if (!news.imageSourceUrl) reasons.push("missing_image_source_url");

  return { passed: reasons.length === 0, reasons };
}

/**
 * Legacy wrapper — คงไว้ backward-compat (Phase 5/6/7 ใช้)
 * คืน boolean เดิม แต่ภายในเรียก evaluateSafetyGate
 */
export function isReadyForAutoPublish(news) {
  return evaluateSafetyGate(news).passed;
}

export async function executeNewsUpdate(ctx, opts = {}, deps = {}) {
  const digestFn = deps.fetchDigest || fetchDigest;
  const articlesFn = deps.fetchArticles || fetchArticles;
  const processBatchFn = deps.processAndSaveBatch || processAndSaveBatch;
  const maxPerRun = Math.max(1, opts.maxPerRun ?? config.scheduler.maxPerRun);
  const autoPublish = opts.autoPublish ?? config.scheduler.autoPublish;
  const startedAt = new Date().toISOString();

  if (!deps.processAndSaveBatch && !config.openai.apiKey && opts.allowMock !== true) {
    throw new Error(
      "MISSING_OPENAI_API_KEY: production news update refuses to store mock AI output"
    );
  }

  const digest = await digestFn({
    maxPerSection: opts.maxPerSection ?? config.scraper.maxPerSection,
    maxAgeHours: opts.maxAgeHours ?? config.scraper.maxAgeHours,
  });

  // Phase 8: เลือก N ข่าวล่าสุดจริงตาม sourcePublishedAt (ไม่ใช่ลำดับ scrape)
  // - กรองเฉพาะข่าวที่มี sourcePublishedAt (ISO UTC) ที่ parse ได้แล้ว
  // - ข่าวที่ไม่มี sourcePublishedAt → แยกไป needsReview (ห้ามเดาเวลา)
  const topNews = selectTopNews(digest.items || [], maxPerRun);
  log.info(
    `selectTopNews: ${topNews.latest.length} latest, ${topNews.rest.length} rest, ${topNews.needsReview.length} needsReview (no sourcePublishedAt)`
  );

  // dedupe กับ DB — ข้ามข่าวที่มีอยู่แล้ว
  const candidates = [];
  let existing = 0;
  for (const item of topNews.latest) {
    const duplicate = ctx.repo.findDuplicate(item);
    if (duplicate.isDuplicate) existing += 1;
    else candidates.push(item);
  }

  // บันทึกข่าวที่ไม่มี sourcePublishedAt เป็น needs_review (ไม่เข้า AI, ไม่ publish)
  // เพื่อรอตรวจทานด้วยมือ — ห้ามเดาเวลา ห้ามใช้ createdAt/publishedAt แทน
  const savedNeedsReview = [];
  for (const item of topNews.needsReview) {
    const news = createEmptyNews();
    news.id = `kitco-review-${item.id}`;
    news.source = item.source || "Kitco News";
    news.sourceUrl = item.sourceUrl;
    news.originalTitle = item.originalTitle;
    news.originalAuthor = item.originalAuthor;
    news.originalPublishedAt = item.originalPublishedAt;
    news.sourcePublishedAt = null; // ห้ามเดา
    news.category = item.category;
    news.originalContent = "";
    news.duplicateHash = duplicateHash({
      urlAlias: item.urlAlias || item.sourceUrl,
      title: news.originalTitle,
    });
    news.topics = item.topics;
    news.section = item.section;
    news.teaser = item.teaser;
    news.isExternal = item.isExternal;
    news.validationStatus = NewsStatus.NEEDS_REVIEW;
    news.publishStatus = NewsStatus.FETCHED;
    news.pipelineNote = "missing_sourcePublishedAt";
    try {
      const saved = ctx.repo.saveWithDedup(news);
      if (saved.saved) savedNeedsReview.push(news.id);
    } catch (err) {
      log.warn(`save needsReview failed: ${err.message} | ${news.id}`);
    }
  }

  const articleBatch = await articlesFn(candidates, {
    delayMs: opts.articleDelayMs ?? config.scraper.articleDelayMs,
  });
  const processed = await processBatchFn(articleBatch.results || [], ctx, {
    aiOpts: opts.aiOpts,
    imageOpts: opts.imageOpts,
    skipImage: opts.skipImage,
  });

  const published = [];
  const held = [];
  for (const result of processed.results || []) {
    if (!result.saved) continue;
    if (autoPublish && isReadyForAutoPublish(result.news)) {
      const ok = ctx.repo.updatePublishStatus(result.news.id, "published");
      if (ok) published.push(result.news.id);
      else held.push({ id: result.news.id, reason: "publish_guard_rejected" });
    } else {
      held.push({
        id: result.news.id,
        reason: autoPublish ? "quality_gate" : "auto_publish_disabled",
      });
    }
  }

  const report = {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    digestItems: (digest.items || []).length,
    existing,
    opened: candidates.length,
    needsReview: savedNeedsReview.length,
    needsReviewIds: savedNeedsReview,
    articleErrors: (articleBatch.errors || []).map((entry) => ({
      sourceUrl: entry.item?.sourceUrl || "",
      error: entry.error?.message || String(entry.error || "unknown_error"),
    })),
    saved: (processed.saved || []).length,
    duplicates: (processed.duplicates || []).length,
    failed: (processed.failed || []).length + (articleBatch.errors || []).length,
    published: published.length,
    publishedIds: published,
    held,
  };
  log.info(
    `update complete: opened=${report.opened} saved=${report.saved} ` +
      `needsReview=${report.needsReview} published=${report.published} failed=${report.failed}`
  );
  return report;
}

export function createNewsUpdater(ctx, deps = {}) {
  let active = null;
  return {
    get running() {
      return active !== null;
    },
    async run(opts = {}) {
      if (active) {
        return { ok: true, skipped: true, reason: "already_running" };
      }
      active = executeNewsUpdate(ctx, opts, deps);
      try {
        return await active;
      } finally {
        active = null;
      }
    },
  };
}
