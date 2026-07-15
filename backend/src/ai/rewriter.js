/* ============================================================
   Rewriter — เรียบเรียงข่าว EN → ไทย ผ่าน OpenAI
   ------------------------------------------------------------
   ขั้นตอน:
   1. สร้าง prompt จาก prompts.buildRewriterMessages
   2. เรียก OpenAI (JSON mode)
   3. ตรวจผลเชิงกล (validator.validateRewritten)
   4. คืนผลพร้อม confidence เบื้องต้น
   ============================================================ */

import { logger } from "../utils/logger.js";
import { chatJson } from "./openai.client.js";
import { buildRewriterMessages, buildCorrectionMessages, CREDIT_LINE } from "./prompts.js";
import { validateRewritten } from "./validator.js";

const log = logger.make("rewriter");

/**
 * เรียบเรียงข่าว EN → ไทย
 * @param {object} news ข่าวต้นฉบับ (ต้องมี originalContent, originalTitle, ...)
 * @param {object} opts { forceMock }
 * @returns {Promise<{
 *   ok: boolean,
 *   rewritten: object|null,   // { thaiTitle, thaiSummary, thaiContent, marketFactors, keyFacts, mentionedNumbers, imageSearchKeywords }
 *   localCheck: object|null,
 *   credit: string,
 *   error?: string,
 *   mock: boolean
 * }>}
 */
export async function rewriteNews(news, opts = {}) {
  if (!news || !news.originalContent) {
    return {
      ok: false,
      rewritten: null,
      localCheck: null,
      credit: CREDIT_LINE,
      error: "news.originalContent ว่าง — ไม่สามารถเรียบเรียงได้",
      mock: false,
    };
  }

  const messages = buildRewriterMessages(news);
  let result;
  try {
    // DI hook สำหรับ test (QC รอบ 2 Finding 4): inject ผล rewrite โดยไม่เรียก API
    if (opts._testRewriteResponse !== undefined) {
      if (opts._testRewriteResponse === null) {
        throw new Error("_test_injected_rewrite_failure");
      }
      result = { json: opts._testRewriteResponse, mock: false };
    } else {
      result = await chatJson({
        messages,
        temperature: 0.4,
        responseFormat: "json",
        forceMock: opts.forceMock,
        requireReal: opts.requireReal,
      });
    }
  } catch (err) {
    log.error(`rewrite call failed: ${err.message}`, { id: news.id });
    return {
      ok: false,
      rewritten: null,
      localCheck: null,
      credit: CREDIT_LINE,
      error: `OpenAI call failed: ${err.message}`,
      mock: false,
    };
  }

  const rewritten = result.json;
  // ตรวจรูปทรงขั้นต่ำ
  if (
    !rewritten ||
    typeof rewritten !== "object" ||
    !rewritten.thaiTitle ||
    !Array.isArray(rewritten.thaiContent)
  ) {
    log.error("AI คืน JSON ไม่ตรง schema", { id: news.id });
    return {
      ok: false,
      rewritten: null,
      localCheck: null,
      credit: CREDIT_LINE,
      error: "AI คืน JSON ไม่ตรง schema",
      mock: result.mock,
    };
  }

  // ตรวจเชิงกลทันที (banned words / numbers)
  const localCheck = validateRewritten(news, rewritten);

  log.info(
    `rewrite OK: "${rewritten.thaiTitle}".slice(0,50) | localConf=${localCheck.localConfidence} | banned=${localCheck.bannedWords.length} | mock=${result.mock}`
  );

  return {
    ok: true,
    rewritten,
    localCheck,
    credit: CREDIT_LINE,
    mock: result.mock,
  };
}

export async function correctRewrite(news, rewritten, issues, opts = {}) {
  try {
    let result;
    if (opts._testCorrectionResponse !== undefined) {
      if (opts._testCorrectionResponse === null) throw new Error("_test_injected_correction_failure");
      result = { json: opts._testCorrectionResponse, mock: false };
    } else {
      result = await chatJson({
        messages: buildCorrectionMessages(news, rewritten, issues),
        temperature: 0.1,
        responseFormat: "json",
        forceMock: opts.forceMock,
        requireReal: opts.requireReal,
      });
    }
    const fixed = result.json;
    if (!fixed?.thaiTitle || !Array.isArray(fixed.thaiContent)) {
      throw new Error("AI correction returned invalid schema");
    }
    return { ok: true, rewritten: fixed, localCheck: validateRewritten(news, fixed), mock: result.mock };
  } catch (error) {
    return { ok: false, error: error.message, rewritten, localCheck: validateRewritten(news, rewritten), mock: false };
  }
}
