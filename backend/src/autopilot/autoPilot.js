/* ============================================================
   Auto Pilot Service (Phase 9)
   ------------------------------------------------------------
   State machine: off → idle → running → (idle | stopped_error)

   หลัก QC (safety):
   - default disabled (env + DB ทั้งคู่ต้องอนุญาตจึงรัน)
   - ป้องกันรันซ้อน: in-process flag + atomic DB lock (CAS)
   - emergency stop: DB flag → เช็คก่อนเริ่มข่าวถัดไป
   - error ระดับข่าว → ข้าม + ทำข่าวถัดไป
   - error ระดับระบบ → release lock 'stopped_error' + lastError
   - reuse pipeline เดิม (fetchDigest/selectTopNews/processAndSaveBatch/evaluateSafetyGate)
   - quality gate เป็น soft warnings: เผยแพร่ได้และติดป้ายให้ Admin ตรวจภายหลัง
   - บล็อกเฉพาะข้อมูลที่สร้างหน้าข่าวไม่ได้จริง
   - audit ทุก stage (no secret)
   ============================================================ */

import { randomUUID } from "node:crypto";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { fetchDigest, fetchArticles, selectTopNews } from "../scraper/kitco.scraper.js";
import { processAndSaveBatch } from "../pipeline/newsPipeline.js";
import { evaluateSafetyGate } from "../pipeline/runNewsUpdate.js";
import { AUDIT_STAGES } from "../store/auditRepository.js";

const log = logger.make("auto-pilot");

/**
 * สร้าง Auto Pilot service
 * @param {object} ctx { repo, apRepo, auditRepo }
 * @param {object} deps DI hooks สำหรับ test:
 *   { fetchDigestFn, fetchArticlesFn, processBatchFn, uuidFn, nowFn, envAllowed }
 */
export function createAutoPilot(ctx, deps = {}) {
  const { repo, apRepo, auditRepo } = ctx;
  if (!repo || !apRepo || !auditRepo) {
    throw new Error("createAutoPilot ต้องการ ctx.{repo, apRepo, auditRepo}");
  }

  const fetchDigestFn = deps.fetchDigestFn || fetchDigest;
  const fetchArticlesFn = deps.fetchArticlesFn || fetchArticles;
  const processBatchFn = deps.processBatchFn || processAndSaveBatch;
  const uuidFn = deps.uuidFn || (() => randomUUID());
  const envAllowed = deps.envAllowed ?? config.autoPilot.enabled;

  let running = false; // in-process lock (คู่กับ DB lock)

  function getStatus() {
    const s = apRepo.getStatus();
    return {
      envAllowed,
      enabled: s.enabled,
      status: s.status,
      maxPerRun: s.maxPerRun,
      lastRunAt: s.lastRunAt,
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
      emergencyStop: s.emergencyStop,
      running,
    };
  }

  /** env + DB ต้องอนุญาตทั้งคู่จึงจะรันจริง */
  function canRun() {
    return envAllowed && apRepo.getStatus().enabled;
  }

  /**
   * เปิด Auto Pilot
   * @returns {{ ok: boolean, error?: string }}
   */
  function enable() {
    if (!envAllowed) {
      return { ok: false, error: "env_not_allowed" };
    }
    const ok = apRepo.setEnabled(true);
    if (!ok) {
      return { ok: false, error: "emergency_stop_active" };
    }
    log.info("auto pilot enabled");
    return { ok: true };
  }

  /** ปิด Auto Pilot */
  function disable() {
    apRepo.setEnabled(false);
    log.info("auto pilot disabled");
    return { ok: true };
  }

  /** ตั้ง emergency stop (atomic) */
  function emergencyStop() {
    apRepo.setEmergencyStop(true);
    log.warn("emergency stop requested — รอบปัจจุบันจะหยุดก่อนข่าวถัดไป");
    return { ok: true };
  }

  /** ล้าง emergency stop */
  function clearEmergencyStop() {
    apRepo.clearEmergencyStop();
    return { ok: true };
  }

  /**
   * Rollback ข่าว published ล่าสุด (ตาม published_at) กลับเป็น 'ready'
   * - ใช้สำหรับ undo การ publish ครั้งล่าสุด (manual)
   * - ไม่ลบข่าว — แค่ unpublish (publish_status → 'ready', published_at → NULL)
   * - บันทึก audit trail
   * @param {object} opts { reviewer }
   * @returns {{ ok: boolean, error?: string, id?: string, title?: string, previousStatus?: string, newStatus?: string }}
   */
  function rollbackLatestPublished({ reviewer } = {}) {
    const latest = repo.listLatestPublished(1)[0];
    if (!latest) {
      log.info("rollback: no published news to roll back");
      return { ok: false, error: "no_published_news" };
    }
    const updated = repo.updatePublishStatus(latest.id, "ready");
    if (!updated) {
      log.warn(`rollback: update failed for ${latest.id}`);
      return { ok: false, error: "update_failed" };
    }
    const runId = `rollback:${uuidFn()}`;
    auditRepo.append({
      runId,
      newsId: latest.id,
      stage: AUDIT_STAGES.NEWS_ROLLBACK,
      status: "ok",
      reason: "manual_rollback",
      metadata: {
        reviewer: reviewer ? String(reviewer).slice(0, 80) : "admin",
        title: latest.thaiTitle || latest.originalTitle || "",
        sourceUrl: latest.sourceUrl || "",
      },
    });
    const title = latest.thaiTitle || latest.originalTitle || "";
    log.info(`rollback completed: ${latest.id} (published→ready) "${title.slice(0, 60)}"`);
    return {
      ok: true,
      id: latest.id,
      title,
      previousStatus: "published",
      newStatus: "ready",
    };
  }

  /**
   * รันรอบเดียว — ใช้ pipeline เดียวกับ scheduler/manual
   *
   * @param {object} opts { maxPerRun?, aiOpts?, imageOpts?, skipImage? }
   * @returns {Promise<object>} report {
   *   ok, runId, skipped?, stopped?, emergency?,
   *   digestItems, processed, published, blocked, failed, publishedIds
   * }
   */
  async function runOnce(opts = {}) {
    // 1) in-process lock
    if (running) {
      return { ok: true, skipped: true, reason: "already_running" };
    }
    // 2) emergency stop check ก่อน acquire
    const preStatus = apRepo.getStatus();
    if (preStatus.emergencyStop) {
      return { ok: false, stopped: true, reason: "emergency_stop_active" };
    }
    // 3) acquire DB lock (atomic CAS)
    const lockToken = uuidFn();
    const acquired = apRepo.acquireLock(lockToken);
    if (!acquired) {
      return { ok: true, skipped: true, reason: "already_running" };
    }
    running = true;
    const runId = uuidFn();
    const startedAt = new Date().toISOString();
    const maxPerRun = Math.max(1, Math.min(3, opts.maxPerRun ?? apRepo.getStatus().maxPerRun ?? config.autoPilot.maxPerRun));

    auditRepo.append({ runId, stage: AUDIT_STAGES.RUN_STARTED, status: "ok", metadata: { maxPerRun, startedAt } });
    log.info(`run started: runId=${runId.slice(0, 8)} maxPerRun=${maxPerRun}`);

    const report = {
      ok: true,
      runId,
      digestItems: 0,
      processed: 0,
      published: 0,
      warned: 0,
      blocked: 0,
      failed: 0,
      publishedIds: [],
    };

    try {
      // === DIGEST ===
      const digest = await fetchDigestFn({
        maxPerSection: opts.maxPerSection ?? config.scraper.maxPerSection,
        maxAgeHours: opts.maxAgeHours ?? config.scraper.maxAgeHours,
      });
      report.digestItems = (digest.items || []).length;
      auditRepo.append({
        runId,
        stage: AUDIT_STAGES.DIGEST_FETCHED,
        status: "ok",
        metadata: { count: report.digestItems, needsReview: (digest.needsReview || []).length },
      });

      // === SELECT (เรียงตาม sourcePublishedAt, dedupe ภายใน batch) ===
      const topNews = selectTopNews(digest.items || [], maxPerRun);
      const candidates = topNews.latest.filter((item) => {
        const dup = repo.findDuplicate(item);
        return !dup.isDuplicate;
      });
      log.info(
        `selected: latest=${topNews.latest.length}, needsReview=${topNews.needsReview.length}, after-dedupe-db=${candidates.length}`
      );
      for (const item of candidates) {
        auditRepo.append({
          runId,
          newsId: `kitco-${item.id}`,
          stage: AUDIT_STAGES.ARTICLE_SELECTED,
          status: "ok",
          metadata: { sourceUrl: item.sourceUrl, sourcePublishedAt: item.sourcePublishedAt },
        });
      }

      // === FETCH ARTICLES + PROCESS (rewrite/validate/image) ===
      const articleBatch = await fetchArticlesFn(candidates, {
        delayMs: opts.articleDelayMs ?? config.scraper.articleDelayMs,
      });
      const processed = await processBatchFn(articleBatch.results || [], ctx, {
        aiOpts: opts.aiOpts,
        imageOpts: opts.imageOpts,
        skipImage: opts.skipImage,
      });
      report.processed = (processed.results || []).length;

      // === SAFETY GATE + PUBLISH ทีละข่าว (พร้อม emergency stop check) ===
      for (const result of processed.results || []) {
        // emergency stop check ก่อนเริ่มข่าวถัดไป
        if (apRepo.getStatus().emergencyStop) {
          auditRepo.append({ runId, stage: AUDIT_STAGES.EMERGENCY_STOP, status: "ok", reason: "stopped_mid_run" });
          log.warn("emergency stop detected mid-run — halting before next news");
          report.stopped = true;
          break;
        }
        if (!result.saved || !result.news) {
          report.failed += 1;
          auditRepo.append({
            runId,
            newsId: result.news?.id,
            stage: AUDIT_STAGES.PUBLISH_BLOCKED,
            status: "skipped",
            reason: "not_saved_or_no_news",
          });
          continue;
        }
        const news = result.news;

        // error ระดับข่าว (processAndSaveNews throw/failed) → audit + ข้าม + ทำข่าวถัดไป
        if (!result.ok) {
          report.failed += 1;
          auditRepo.append({
            runId,
            newsId: news.id,
            stage: AUDIT_STAGES.VALIDATION_FAILED,
            status: "error",
            reason: result.error || "process_failed",
          });
          continue;
        }

        // audit rewrite + image completed
        auditRepo.append({
          runId,
          newsId: news.id,
          stage: AUDIT_STAGES.REWRITE_COMPLETED,
          status: "ok",
          metadata: { validationStatus: news.validationStatus, mock: result.imageStatus === null ? null : undefined },
        });
        auditRepo.append({
          runId,
          newsId: news.id,
          stage: AUDIT_STAGES.IMAGE_COMPLETED,
          status: "ok",
          metadata: { imageStatus: news.imageStatus, reviewRequired: news.imageReviewRequired },
        });

        // === QUALITY CHECK (soft warnings) ===
        const gate = evaluateSafetyGate(news, {
          isMockRun: result.reason && String(result.reason).includes("mock"),
        });
        const warnings = gate.reasons.filter((reason) => reason !== "already_published");
        auditRepo.append({
          runId,
          newsId: news.id,
          stage: AUDIT_STAGES.VALIDATION_PASSED,
          status: warnings.length ? "warning" : "ok",
          reason: warnings.length ? warnings.join(",") : undefined,
          metadata: { publishWarnings: warnings },
        });
        const publishResult = repo.publishWithWarnings(news.id, warnings);
        if (publishResult.published) {
          report.published += 1;
          if (warnings.length) report.warned += 1;
          report.publishedIds.push(news.id);
          auditRepo.append({
            runId,
            newsId: news.id,
            stage: AUDIT_STAGES.PUBLISH_COMPLETED,
            status: warnings.length ? "warning" : "ok",
            reason: warnings.length ? warnings.join(",") : undefined,
            metadata: { publishWarnings: warnings },
          });
          log.info(`publish completed: ${news.id}${warnings.length ? ` warnings=${warnings.join("|")}` : ""}`.slice(0, 240));
        } else {
          report.blocked += 1;
          auditRepo.append({
            runId,
            newsId: news.id,
            stage: AUDIT_STAGES.PUBLISH_BLOCKED,
            status: "blocked",
            reason: publishResult.error || "publish_technical_failure",
          });
        }
      }

      // === COMPLETE ===
      apRepo.recordRunSuccess(new Date().toISOString());
      auditRepo.append({
        runId,
        stage: AUDIT_STAGES.RUN_COMPLETED,
        status: "ok",
        metadata: {
          published: report.published,
          warned: report.warned,
          blocked: report.blocked,
          failed: report.failed,
          stopped: !!report.stopped,
        },
      });
      log.info(
        `run completed: runId=${runId.slice(0, 8)} published=${report.published} blocked=${report.blocked} failed=${report.failed}`
      );
      return report;
    } catch (err) {
      // === SYSTEM ERROR — หยุดรอบ + stopped_error ===
      report.ok = false;
      report.error = err.message;
      apRepo.recordRunError(new Date().toISOString(), err.message);
      auditRepo.append({
        runId,
        stage: AUDIT_STAGES.RUN_FAILED,
        status: "error",
        reason: err.message,
      });
      log.error(`run failed: runId=${runId.slice(0, 8)} ${err.message}`);
      return report;
    } finally {
      // release DB lock — idle หรือ stopped_error (system error)
      // (emergency stop ไม่ใช่ error → idle)
      const releaseStatus = report.ok === false ? "stopped_error" : "idle";
      apRepo.releaseLock(lockToken, releaseStatus);
      running = false;
    }
  }

  return {
    getStatus,
    canRun,
    enable,
    disable,
    emergencyStop,
    clearEmergencyStop,
    rollbackLatestPublished,
    runOnce,
    // expose สำหรับ test
    get _running() {
      return running;
    },
  };
}
