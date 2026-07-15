/* ============================================================
   Validator (local) — ตรวจสอบเชิงกล ก่อน/หลังเรียก AI
   ------------------------------------------------------------
   เป็นชั้นป้องกันที่ทำงานเร็วและแน่นอน (ไม่พึ่ง AI):
   - ตรวจคำต้องห้าม (exact + คล้าย)
   - ตรวจตัวเลขในต้นฉบับว่ามีครบในข่าวไทยหรือไม่ (missing)
   - ตรวจตัวเลขในข่าวไทยที่ไม่มีในต้นฉบับ (unexpected/added)
   - คำนวณ confidence เบื้องต้น (AI จะปรับเพิ่มในขั้น validator prompt)

   QC รอบ 1 — ปิดช่องโหว่:
   - number checker คืนทั้ง missing และ unexpected
   - normalize $, comma, decimal, % ก่อนเปรียบเทียบ
   - ถ้ามี unexpected → ห้าม validated (อย่างน้อย needs_review)
   ============================================================ */

import { BANNED_PHRASES } from "./prompts.js";

/**
 * Normalize ตัวเลขเดี่ยวๆ ให้เป็นรูปมาตรฐานก่อนเปรียบเทียบ
 * - ตัด $ และ comma
 * - คงทศนิยมและ % ไว้
 * เช่น "$4,089.10" → "4089.10", "2.22%" → "2.22%", "$59.12" → "59.12"
 */
function normalizeNumToken(token) {
  return String(token)
    .replace(/[−–—]/g, "-")
    .replace(/[$€£฿,\s]/g, "")
    .trim()
    .toLowerCase();
}

// บริบทที่บ่งว่าตัวเลขข้างเคียงเป็น "ข้อมูลการเงิน/เวลา" ที่ต้องตรวจแม่นยำ
// (ใช้ลด false positive ของเลขสั้น เช่น "1st", "2 people")
// EN + TH keywords
const FINANCIAL_CONTEXT =
  /(?:\$|usd|dollars?|baht|บาท|ดอลลาร์|oz|ounce|ออนซ์|oz\/t|%\s|percent|เปอร์เซ็นต์|basis\s+points?|bps|bp\b|rate|อัตรา|yield|cpi|fed|fomc|points?|จุด|pip|barrel|บาร์เรล|tons?|ตัน|kg|กิโล|wk|week|สัปดาห์|month|เดือน|year|ปี)/i;

// รูปแบบ ordinal/ลำดับที่ต้องข้าม (ลด false positive)
// EN: 1st, 2nd, 3rd, 21st / TH: ที่ 1, ลำดับที่ 2, ครั้งที่ 3, ไตรมาสที่ 1
const ORDINAL_PATTERN =
  /(?:\b\d{1,2}(?:st|nd|rd|th)\b)|(?:ที่\s*\d{1,2})|(?:ลำดับที่\s*\d{1,2})|(?:ครั้งที่\s*\d{1,2})|(?:ไตรมาสที่\s*\d{1,2})|(?:ข้อที่\s*\d{1,2})|(?:phase\s*\d{1,2})/i;

/**
 * ตรวจว่า token ตัวเลขนี้ "สำคัญ" พอจะต้องนำไปเทียบ หรือเป็น noise
 * สำคัญ = มี comma / decimal / % / ≥3 หลัก / เป็นปี (2020-2099) / อยู่ในบริบทการเงิน
 * noise  = ordinal (1st, ที่ 1, ไตรมาสที่ 1) ที่ไม่ใช่ figure
 */
function isSignificantNumber(token, fullText, index) {
  const cleaned = token.replace(/[−–—$€£฿,\s%]/g, "").replace(/^-/, "");
  // ข้าม ordinal ก่อน (ลด false positive) — เฉพาะเลข 1-2 หลักที่ไม่มี %/comma/decimal
  if (/^\d{1,2}$/.test(cleaned)) {
    const start = Math.max(0, index - 30);
    const end = Math.min(fullText.length, index + token.length + 10);
    const around = fullText.slice(start, end);
    if (ORDINAL_PATTERN.test(around)) return false;
  }
  // ปี (2020-2099) → สำคัญเสมอ (QC: ต้องจับการเปลี่ยน 2025→2026)
  if (/^(20[2-9]\d|21\d\d)$/.test(cleaned)) return true;
  // ≥3 หลัก หรือมี comma/decimal/% → สำคัญเสมอ
  if (/\d{3,}/.test(cleaned) || /[,.%]/.test(token)) return true;
  // เลข 1-2 หลักที่เหลือ → สำคัญเฉพาะเมื่ออยู่ในบริบทการเงิน
  const start = Math.max(0, index - 25);
  const end = Math.min(fullText.length, index + token.length + 25);
  const ctx = fullText.slice(start, end);
  return FINANCIAL_CONTEXT.test(ctx);
}

/**
 * ดึงตัวเลขทั้งหมดที่เป็นข้อมูลสำคัญจากข้อความ (QC รอบ 2 — ครอบคลุมทุกขนาด)
 * จับ: 2,366 / 4,100 / 2.22% / $59.12 / 9999 / 25 (basis points) / 2025 (ปี)
 * ลด false positive: เลข 1-2 หลักเฉพาะเมื่ออยู่ในบริบทการเงิน
 * คืนเป็น Set ของ normalized string เพื่อเทียบแม่นยำ
 */
function extractNumbers(text) {
  if (!text) return new Set();
  const out = new Set();
  const full = String(text);
  // จับเลขทุกรูปแบบ: comma / decimal / % / ล้วน (ทุกจำนวนหลัก)
  const re =
    /[-−–—]?[$€£฿]?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|[-−–—]?[$€£฿]?\d+\.\d+%?|[-−–—]?[$€£฿]?\d+%\b|[-−–—]?\b\d+\b/g;
  let m;
  const reGlobal = new RegExp(re.source, "g");
  while ((m = reGlobal.exec(full)) !== null) {
    const token = m[0];
    const idx = m.index;
    if (!isSignificantNumber(token, full, idx)) continue;
    out.add(normalizeNumToken(token));
  }
  return out;
}

/**
 * ตรวจคำต้องห้ามในข้อความไทย
 * @returns {string[]} รายการคำต้องห้ามที่พบ
 */
export function findBannedWords(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const found = [];
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      found.push(phrase);
    }
  }
  return found;
}

/**
 * ตรวจว่ามีคำที่บ่งคำแนะนำการลงทุนหรือไม่ (heuristic)
 */
const ADVICE_PATTERNS = [
  /ควรซื้อ/,
  /ควรขาย/,
  /แนะนำให้(ซื้อ|ขาย|ลงทุน)/,
  /โอกาส(ทอง|ฉลาด)/,
  /รับประกัน(ผล|กำไร)/,
  /guaranteed/i,
  /you should (buy|sell)/i,
];
export function findInvestmentAdvice(text) {
  if (!text) return [];
  const found = [];
  for (const re of ADVICE_PATTERNS) {
    const m = String(text).match(re);
    if (m) found.push(m[0]);
  }
  return found;
}

/**
 * ตรวจตัวเลขระหว่างต้นฉบับและข่าวไทย
 * คืนทั้ง:
 *   - missing:   เลขในต้นฉบับที่หายไปจากข่าวไทย
 *   - unexpected: เลขในข่าวไทยที่ไม่มีในต้นฉบับ (น่าจะแต่งเพิ่ม)
 *
 * @returns {{ missing: string[], unexpected: string[], originalCount: number, thaiCount: number }}
 */
export function checkNumbers(originalText, thaiText) {
  const origSet = extractNumbers(originalText);
  const thaiSet = extractNumbers(
    Array.isArray(thaiText) ? thaiText.join(" ") : thaiText
  );

  const missing = [...origSet].filter((n) => !thaiSet.has(n));
  const unexpected = [...thaiSet].filter((n) => !origSet.has(n));

  return {
    missing,
    unexpected,
    originalCount: origSet.size,
    thaiCount: thaiSet.size,
  };
}

/** AI is advisory for number matching. Only a locally observed added number, or
 * an AI mismatch whose normalized values truly differ, may block publishing. */
export function reconcileNumberValidation(aiValidation, numberCheck) {
  const unexpected = new Set(numberCheck.unexpected || []);
  const realAiMismatches = (aiValidation?.numberMismatches || []).filter((item) => {
    if (!item || typeof item !== "object") return false;
    const original = normalizeNumToken(item.original || "");
    const rewritten = normalizeNumToken(item.rewritten || "");
    // If the rewritten value exists anywhere in the source, the AI merely
    // paired two unrelated source figures and must not call it a mismatch.
    return original && rewritten && original !== rewritten && unexpected.has(rewritten);
  });
  return {
    numbersMatch: numberCheck.unexpected.length === 0 && realAiMismatches.length === 0,
    realAiMismatches,
    aiDisagreed: aiValidation?.numbersMatch === false && realAiMismatches.length === 0,
  };
}

/**
 * คำนวณ confidence เบื้องต้นจากการตรวจเชิงกล
 * (AI validator จะปรับเพิ่มภายหลัง — ใช้ค่าต่ำสุดเป็นเกณฑ์)
 *
 * หักคะแนน:
 * - พบคำต้องห้าม: -50 (ร้ายแรง)
 * - พบคำแนะนำลงทุน: -30
 * - ตัวเลข missing >30%: -20 / 10-30%: -10
 * - ตัวเลข unexpected ทุกตัว: -15 ต่อตัว (แต่งเพิ่ม)
 */
export function localConfidence(opts) {
  let score = 100;
  const issues = [];

  if (opts.bannedWords && opts.bannedWords.length) {
    score -= 50;
    issues.push(`banned_words:${opts.bannedWords.length}`);
  }
  if (opts.adviceWords && opts.adviceWords.length) {
    score -= 30;
    issues.push(`investment_advice:${opts.adviceWords.length}`);
  }
  // A summary is not required to repeat every source number. Missing source
  // numbers are recorded for review but are not an accuracy failure.
  if (opts.numberCheck?.missing?.length) {
    issues.push(`numbers_omitted:${opts.numberCheck.missing.length}`);
  }
  // unexpected numbers → หักคะแนน (แต่งเพิ่ม = ความเสี่ยงด้านความถูกต้อง)
  if (opts.numberCheck && opts.numberCheck.unexpected.length) {
    const penalty = Math.min(15 * opts.numberCheck.unexpected.length, 45);
    score -= penalty;
    issues.push(`numbers_unexpected:${opts.numberCheck.unexpected.length}`);
  }
  return { score: Math.max(0, score), issues };
}

/**
 * ตรวจข่าวไทยที่เรียบเรียงแล้วทั้งหมด (รวมทุกฟังก์ชันข้างต้น)
 * ใช้หลังได้ผลจาก rewriter
 *
 * @returns object รวมผลการตรวจ พร้อมฟิลด์ใหม่:
 *   - hasUnexpectedNumbers: boolean (มีเลขแต่งเพิ่ม → ห้าม validated)
 *   - passesLocalGate: boolean (ไม่มี banned/advice)
 *   - canAutoValidate: boolean (ผ่าน local gate + ไม่มี unexpected numbers)
 */
export function validateRewritten(originalNews, rewritten) {
  // QC รอบ 2 Finding 1: ตรวจเลขใน output ทุก field (ไม่ใช่แค่ content/market/mentioned)
  const thaiFlat = [
    rewritten.thaiTitle,
    rewritten.thaiSummary,
    ...(rewritten.thaiContent || []),
    rewritten.marketFactors,
    ...(rewritten.keyFacts || []),
  ]
    .filter(Boolean)
    .join(" ");

  const bannedWords = findBannedWords(thaiFlat);
  const adviceWords = findInvestmentAdvice(thaiFlat);
  const numberCheck = checkNumbers(
    [originalNews.originalTitle, originalNews.originalContent].filter(Boolean).join(" "),
    // รวมทุก field ที่อาจมีตัวเลขของข่าวไทย
    [
      rewritten.thaiTitle,
      rewritten.thaiSummary,
      ...(rewritten.thaiContent || []),
      rewritten.marketFactors,
      ...(rewritten.keyFacts || []),
      ...(rewritten.mentionedNumbers || []),
    ]
      .filter(Boolean)
      .join(" ")
  );
  const local = localConfidence({ bannedWords, adviceWords, numberCheck });

  const hasUnexpectedNumbers = numberCheck.unexpected.length > 0;

  return {
    bannedWords,
    adviceWords,
    numberCheck,
    hasUnexpectedNumbers,
    localConfidence: local.score,
    issues: local.issues,
    // ผ่านเงื่อนไขเบื้องต้น (ไม่มี banned/advice)
    passesLocalGate:
      bannedWords.length === 0 && adviceWords.length === 0,
    // สามารถ validated ได้ทาง local เลยหรือไม่ (ยังต้องผ่าน AI gate อีกที)
    canAutoValidate:
      bannedWords.length === 0 &&
      adviceWords.length === 0 &&
      !hasUnexpectedNumbers,
  };
}
