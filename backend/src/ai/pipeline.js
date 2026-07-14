/* ============================================================
   AI Pipeline — orchestrate ข่าว 1 รายการผ่านระบบ OpenAI
   ------------------------------------------------------------
   ลำดับ:
   1. ตรวจ source policy → ถ้าไม่ TRUSTED → needs_review (หยุด ไม่ส่ง AI)
   2. ตรวจว่ามี originalContent (ดึงเนื้อหาเต็มแล้ว) → ถ้าไม่มี → needs_review
   3. rewriteNews() — เรียบเรียง EN → ไทย
   4. local validator (เชิงกล) — ถ้าพบคำต้องห้าม → rejected ทันที
   5. AI validator — ตรวจตัวเลข + คำแนะนำลงทุน + confidence
   6. รวม confidence (min ของ local + AI)
   7. ตั้งสถานะตามเกณฑ์

   QC รอบ 1 — hard gates (ปิดช่องโหว่):
   - mock output ห้าม validated เด็ดขาด → สูงสุด needs_review
   - --real ไม่มี key → fail fast (อยู่ใน openai.client.js)
   - AI validator ล้มเหลว/ผิด schema/ไม่มีผล → needs_review (ห้าม fallback validated)
   - aiValidation.isValid === false → ห้าม validated
   - type check ทุก field (boolean, confidence 0-100)
   - bannedWordsFound / adviceFound / numbersMatch=false / addedInfo=true → ลดสถานะ
   - unexpected numbers → ห้าม validated อย่างน้อย needs_review
   ============================================================ */

import { logger } from "../utils/logger.js";
import { NewsStatus } from "../utils/schema.js";
import { classifySource, SourcePolicy } from "./sourcePolicy.js";
import { rewriteNews } from "./rewriter.js";
import { validateRewritten } from "./validator.js";
import { buildValidatorMessages } from "./prompts.js";
import { chatJson } from "./openai.client.js";

const log = logger.make("pipeline");

// เกณฑ์ confidence ตามที่กำหนด
const PUBLISH_THRESHOLD = 85; // 85-100 → validated
const REVIEW_THRESHOLD = 70; // 70-84 → needs_review, <70 → rejected

/**
 * ตรวจชนิดข้อมูลของ AI validator output (QC: type check ทุก field)
 * คืน { valid: boolean, errors: string[], normalized }
 */
function validateAiValidationShape(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["not_an_object"], normalized: null };
  }
  const n = (v, lo, hi) =>
    typeof v === "number" && v >= lo && v <= hi;
  const b = (v) => typeof v === "boolean";
  const arr = (v) => Array.isArray(v);

  // QC รอบ 2 Finding 2: ทุก safety field เป็น REQUIRED + fail closed
  // (ก่อนหน้านี้ตรวจเฉพาะเมื่อ "!== undefined" → ขาด field จะข้าม hard gate ได้)
  if (!b(raw.isValid)) errors.push("isValid_required_boolean");
  if (!arr(raw.bannedWordsFound)) errors.push("bannedWordsFound_required_array");
  if (!b(raw.investmentAdviceFound))
    errors.push("investmentAdviceFound_required_boolean");
  if (!b(raw.numbersMatch)) errors.push("numbersMatch_required_boolean");
  if (!arr(raw.numberMismatches))
    errors.push("numberMismatches_required_array");
  if (!b(raw.addedInformationFound))
    errors.push("addedInformationFound_required_boolean");
  if (!n(raw.confidence, 0, 100)) errors.push("confidence_required_number_0_100");

  return { valid: errors.length === 0, errors, normalized: raw };
}

/**
 * ประมวลผลข่าว 1 รายการผ่าน pipeline AI ทั้งหมด
 *
 * @param {object} news ข่าว (มี originalContent, source, isExternal, ...)
 * @param {object} opts { forceMock, requireReal, skipAiValidate }
 * @returns {Promise<object>} news ที่อัปเดตแล้ว + ข้อมูลการประมวลผล
 */
export async function processNews(news, opts = {}) {
  const result = {
    ...news,
    validationStatus: NewsStatus.PROCESSING,
    publishStatus: NewsStatus.PROCESSING,
  };

  // ---- 1) Source policy gate ----
  const policy = classifySource(news);
  result.sourcePolicy = policy.policy;
  result.sourcePolicyReason = policy.reason;
  if (policy.policy !== SourcePolicy.TRUSTED) {
    result.validationStatus = NewsStatus.NEEDS_REVIEW;
    // QC Phase 5: publishStatus แยกจาก validationStatus — คง PROCESSING (ห้าม mirror, ห้าม PUBLISHED)
    result.publishStatus = NewsStatus.PROCESSING;
    result.aiConfidence = null;
    result.pipelineNote = `source_policy:${policy.reason} — รอนโยบายสิทธิ์การใช้งาน`;
    log.info(
      `SKIP AI (needs_review): source="${news.source}" reason=${policy.reason} | ${news.originalTitle}`.slice(0, 100)
    );
    return { ok: false, skipped: true, reason: "source_policy", policy, news: result };
  }

  // ---- 2) ต้องมีเนื้อหาเต็ม ----
  if (!news.originalContent || news.originalContent.length < 100) {
    result.validationStatus = NewsStatus.NEEDS_REVIEW;
    result.publishStatus = NewsStatus.PROCESSING; // QC Phase 5: แยกจาก validation
    result.pipelineNote = "missing_or_short_content — รอตรวจสอบเนื้อหา";
    log.warn(`SKIP AI: originalContent สั้นเกินไป (${news.originalContent?.length || 0} chars)`);
    return {
      ok: false,
      skipped: true,
      reason: "missing_content",
      news: result,
    };
  }

  // ---- 3) Rewrite ----
  const rewrite = await rewriteNews(news, {
    forceMock: opts.forceMock,
    requireReal: opts.requireReal,
    _testRewriteResponse: opts._testRewriteResponse,
  });
  if (!rewrite.ok) {
    result.validationStatus = NewsStatus.FAILED;
    result.publishStatus = NewsStatus.PROCESSING; // QC Phase 5: แยกจาก validation
    result.pipelineNote = `rewrite_failed: ${rewrite.error}`;
    log.error(`rewrite failed: ${rewrite.error}`);
    return { ok: false, skipped: false, reason: "rewrite_failed", error: rewrite.error, news: result };
  }

  // ใส่ข้อมูลที่เรียบเรียงแล้วเข้า news
  const w = rewrite.rewritten;
  result.thaiTitle = w.thaiTitle;
  result.thaiSummary = w.thaiSummary;
  result.thaiContent = w.thaiContent;
  result.marketFactors = w.marketFactors;
  result.keyFacts = w.keyFacts;
  result.mentionedNumbers = w.mentionedNumbers;
  result.imageSearchKeywords = w.imageSearchKeywords || [];
  result.credit = rewrite.credit;
  const localCheck = rewrite.localCheck;
  const isMockRun = rewrite.mock === true;

  // ---- 4) Local gate: ถ้าพบคำต้องห้าม → rejected ทันที ----
  if (!localCheck.passesLocalGate) {
    result.validationStatus = NewsStatus.REJECTED;
    result.publishStatus = NewsStatus.PROCESSING; // QC Phase 5: แยกจาก validation
    result.aiConfidence = localCheck.localConfidence;
    result.pipelineNote = `rejected_local: banned=${localCheck.bannedWords.join(",")} advice=${localCheck.adviceWords.join(",")}`;
    log.error(
      `REJECTED (local gate): banned=${localCheck.bannedWords.length} advice=${localCheck.adviceWords.length} | ${result.thaiTitle}`
    );
    return {
      ok: true,
      skipped: false,
      reason: "rejected_local",
      localCheck,
      mock: isMockRun,
      news: result,
    };
  }

  // ---- 5) AI Validator (hard gate) ----
  let aiValidation = null;
  let aiGateBlockReason = null; // ถ้าไม่ null → ห้าม validated

  // QC รอบ 2 Finding 3: skipAiValidate ต้องไม่มีทางไปถึง validated
  // (ก่อนหน้านี้ skip แล้ว aiGateBlockReason เป็น null → ใช้ local confidence ได้ validated)
  // ปัจจุบัน: skip → ตั้ง block reason → สูงสุด needs_review
  if (opts.skipAiValidate) {
    aiGateBlockReason = "ai_validator_skipped";
    log.warn("skipAiValidate=true → block validated (สูงสุด needs_review)");
  } else {
    const vMessages = buildValidatorMessages(news, w);
    try {
      // DI hook สำหรับ test (QC รอบ 2 Finding 4): inject ผล validator โดยไม่เรียก API
      // production path ปกติไม่มี caller ส่ง option นี้
      let vRes;
      if (opts._testValidatorResponse !== undefined) {
        if (opts._testValidatorResponse === null) {
          throw new Error("_test_injected_validator_failure");
        }
        vRes = { json: opts._testValidatorResponse, mock: false };
      } else {
        vRes = await chatJson({
          messages: vMessages,
          temperature: 0.1,
          responseFormat: "json",
          forceMock: opts.forceMock,
          requireReal: opts.requireReal,
        });
      }
      const shape = validateAiValidationShape(vRes.json);
      if (!shape.valid) {
        // QC: JSON ผิด schema → needs_review (ห้าม fallback validated)
        aiGateBlockReason = `ai_validator_bad_shape:${shape.errors.join(",")}`;
        log.warn(`AI validator คืน schema ไม่ถูกต้อง: ${shape.errors.join(",")}`);
      } else {
        aiValidation = shape.normalized;
        result.aiValidationRaw = aiValidation;

        // QC: hard gate — isValid === false → ห้าม validated
        if (aiValidation.isValid === false) {
          aiGateBlockReason = "ai_validator_invalid";
        }
        // QC: หาก AI พบปัญหาใดในนี้ → ห้าม validated (อย่างน้อย needs_review)
        const bannedFound =
          Array.isArray(aiValidation.bannedWordsFound) &&
          aiValidation.bannedWordsFound.length > 0;
        if (bannedFound) aiGateBlockReason = "ai_banned_words";
        if (aiValidation.investmentAdviceFound === true)
          aiGateBlockReason = "ai_investment_advice";
        if (aiValidation.numbersMatch === false)
          aiGateBlockReason = "ai_numbers_mismatch";
        if (aiValidation.addedInformationFound === true)
          aiGateBlockReason = "ai_added_information";
        // mock output ของ validator เอง → ห้าม validated
        if (aiValidation.mockOnly === true)
          aiGateBlockReason = "ai_validator_mock_only";
      }
    } catch (err) {
      // QC: validator failure → needs_review (ห้าม fallback ไป local confidence แล้ว validated)
      aiGateBlockReason = `ai_validator_failed:${err.message}`;
      log.warn(`AI validator failed → block validated: ${err.message}`);
      aiValidation = null;
    }
  }

  // ---- 6) รวม confidence ----
  let confidence = localCheck.localConfidence;
  if (aiValidation && typeof aiValidation.confidence === "number") {
    confidence = Math.min(confidence, aiValidation.confidence);
  }
  // หัก confidence หาก AI พบปัญหา (ยังคงเก็บไว้เพื่อคะแนน reference)
  if (aiValidation) {
    if (aiValidation.investmentAdviceFound) confidence = Math.min(confidence, 60);
    if (aiValidation.numbersMatch === false) confidence = Math.min(confidence, 65);
    if (aiValidation.addedInformationFound) confidence = Math.min(confidence, 75);
  }
  result.aiConfidence = confidence;
  result.aiValidation = aiValidation;

  // ---- 7) ตั้งสถานะตามเกณฑ์ (พร้อม hard gates) ----
  // Hard gates ที่บังคับห้าม validated:
  //   - mock run (isMockRun)
  //   - aiGateBlockReason !== null
  //   - local unexpected numbers
  const hardBlockValidated =
    isMockRun ||
    aiGateBlockReason !== null ||
    localCheck.hasUnexpectedNumbers;

  let status;
  let note;
  if (hardBlockValidated) {
    // ไม่ว่า confidence จะสูงแค่ไหน → สูงสุดคือ needs_review
    if (confidence < REVIEW_THRESHOLD) {
      status = NewsStatus.REJECTED;
    } else {
      status = NewsStatus.NEEDS_REVIEW;
    }
    const blockers = [];
    if (isMockRun) blockers.push("mock_run");
    if (aiGateBlockReason) blockers.push(aiGateBlockReason);
    if (localCheck.hasUnexpectedNumbers) blockers.push("unexpected_numbers");
    note = `blocked_validated:[${blockers.join(",")}] (conf=${confidence})`;
  } else if (confidence >= PUBLISH_THRESHOLD) {
    status = NewsStatus.VALIDATED;
    note = `validated (conf=${confidence})`;
  } else if (confidence >= REVIEW_THRESHOLD) {
    status = NewsStatus.NEEDS_REVIEW;
    note = `needs_review (conf=${confidence})`;
  } else {
    status = NewsStatus.REJECTED;
    note = `rejected (conf=${confidence})`;
  }
  result.validationStatus = status;
  // QC Phase 5: publishStatus แยกจาก validationStatus อย่างเด็ดขาด
  //   validationStatus=VALIDATED ไม่ทำให้ publishStatus เปลี่ยนเป็น PUBLISHED
  //   publishStatus คง PROCESSING จนกว่าจะมี explicit publish action (Phase ถัดไป)
  result.publishStatus = NewsStatus.PROCESSING;
  result.pipelineNote = note;

  log.info(
    `pipeline done: conf=${confidence} status=${status} | ${result.thaiTitle}`.slice(0, 110),
    {
      banned: localCheck.bannedWords.length,
      missingNums: localCheck.numberCheck.missing.length,
      unexpectedNums: localCheck.numberCheck.unexpected.length,
      aiValid: aiValidation ? aiValidation.isValid : "n/a",
      mock: isMockRun,
      block: aiGateBlockReason,
    }
  );

  return {
    ok: true,
    skipped: false,
    reason: note,
    localCheck,
    aiValidation,
    mock: isMockRun,
    news: result,
  };
}

/**
 * ประมวลผลข่าวหลายรายการ ตามลำดับ (rate-limit friendly)
 * @returns { results, validated, needsReview, rejected, failed }
 */
export async function processBatch(newsList, opts = {}) {
  const results = [];
  const buckets = { validated: [], needsReview: [], rejected: [], failed: [] };
  for (const news of newsList) {
    try {
      const r = await processNews(news, opts);
      results.push(r);
      if (r.skipped) {
        buckets.needsReview.push(r);
      } else if (r.news.validationStatus === NewsStatus.VALIDATED) {
        buckets.validated.push(r);
      } else if (r.news.validationStatus === NewsStatus.NEEDS_REVIEW) {
        buckets.needsReview.push(r);
      } else if (r.news.validationStatus === NewsStatus.REJECTED) {
        buckets.rejected.push(r);
      } else {
        buckets.failed.push(r);
      }
    } catch (err) {
      buckets.failed.push({ ok: false, error: err.message, news });
      log.error(`batch item failed: ${err.message}`);
    }
  }
  return { results, ...buckets };
}

// export เพื่อให้ test เข้าถึงได้
export const __PUBLISH_THRESHOLD = PUBLISH_THRESHOLD;
export const __REVIEW_THRESHOLD = REVIEW_THRESHOLD;
export { validateAiValidationShape };
