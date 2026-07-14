import { config } from "../config/env.js";
import { fetchDigest, fetchArticles } from "../scraper/kitco.scraper.js";
import { processAndSaveBatch } from "./newsPipeline.js";
import { logger } from "../utils/logger.js";

const log = logger.make("news-update");

export function isReadyForAutoPublish(news) {
  return !!(
    news &&
    news.validationStatus === "validated" &&
    news.imageStatus === "selected" &&
    news.imageReviewRequired === false &&
    news.thaiTitle &&
    Array.isArray(news.thaiContent) &&
    news.thaiContent.length > 0 &&
    news.sourceUrl &&
    news.credit &&
    news.imageUrl &&
    news.imageSourceUrl
  );
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

  const candidates = [];
  let existing = 0;
  for (const item of digest.items || []) {
    const duplicate = ctx.repo.findDuplicate(item);
    if (duplicate.isDuplicate) existing += 1;
    else candidates.push(item);
    if (candidates.length >= maxPerRun) break;
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
      `published=${report.published} failed=${report.failed}`
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
