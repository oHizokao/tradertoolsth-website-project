/* ============================================================
   Source Policy — นโยบายสิทธิ์การใช้งานตามแหล่งที่มา
   ------------------------------------------------------------
   กฎที่ Codex กำหนด (Phase 3 + QC รอบ 1):
   • ข่าวที่มี source เป็น Reuters หรือแหล่งภายนอก
     → ตั้งสถานะ needs_review
     → ห้ามส่งเข้า OpenAI อัตโนมัติจนกว่าจะกำหนดนโยบายชัดเจน

   แนวทาง (QC รอบ 1 — ปิดช่องโหว่):
   - ห้ามใช้ substring includes() สำหรับ trusted source
   - Normalize: trim + lowercase + collapse whitespace
   - ใช้ EXACT allowlist (เท่านั้น) สำหรับชื่อที่อนุญาต
   - ชื่อปลอมที่มีคำว่า "Kitco" ต้องเป็น needs_review
   - isExternal=true → block ก่อนตรวจชื่อ source เสมอ
   ============================================================ */

// EXACT allowlist — ชื่อต้นทางที่อนุญาตให้ส่งเข้า AI (หลัง normalize)
// ห้ามเพิ่มโดยใช้ keyword/substring เด็ดขาด
const TRUSTED_SOURCES = new Set([
  "kitco news",
  "kitco newswire",
  "kitco newsdesk",
]);

// Wire services / aggregator ของบุคคลที่สาม — ใช้เป็น hint log เท่านั้น
// (การตัดสินใจจริงอิงจาก allowlist: ถ้าไม่อยู่ใน allowlist → needs_review)
const THIRD_PARTY_HINTS = [
  "reuters",
  "associated press",
  "bloomberg",
  "mining.com",
  "economic times",
  "afp",
  "dow jones",
  "marketwatch",
  "cnbc",
  "wsj",
  "financial times",
  "forbes",
];

export const SourcePolicy = Object.freeze({
  TRUSTED: "trusted", // ส่งเข้า OpenAI ได้
  NEEDS_REVIEW: "needs_review", // ห้ามส่งอัตโนมัติ รอนโยบาย/ตรวจสอบ
});

/** Normalize ชื่อ source: trim + lowercase + collapse whitespace */
export function normalizeSourceName(source) {
  return String(source || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * จำแนกสถานะสิทธิ์การใช้งานของข่าว
 *
 * ลำดับการตรวจ (สำคัญ):
 *   1. isExternal=true → NEEDS_REVIEW เสมอ (ก่อนตรวจชื่อ)
 *   2. source ว่าง     → NEEDS_REVIEW
 *   3. exact match กับ TRUSTED_SOURCES → TRUSTED
 *   4. อื่นๆ ทั้งหมด    → NEEDS_REVIEW (รวมชื่อปลอมที่มีคำว่า "kitco")
 *
 * @param {object} news ต้องมี source และควรมี isExternal
 * @returns {{ policy: 'trusted'|'needs_review', reason: string }}
 */
export function classifySource(news) {
  // 1) External link → block ก่อนเสมอ (ก่อนตรวจชื่อ source)
  if (news.isExternal === true) {
    return {
      policy: SourcePolicy.NEEDS_REVIEW,
      reason: "external_link",
    };
  }

  // 2) ไม่มีชื่อ source → needs_review
  const rawSource = String(news.source || "").trim();
  if (!rawSource) {
    return {
      policy: SourcePolicy.NEEDS_REVIEW,
      reason: "unknown_source",
    };
  }

  // 3) EXACT allowlist เท่านั้น (หลัง normalize)
  const normalized = normalizeSourceName(rawSource);
  if (TRUSTED_SOURCES.has(normalized)) {
    return { policy: SourcePolicy.TRUSTED, reason: "kitco:exact" };
  }

  // 4) อื่นๆ ทั้งหมด → needs_review
  //    ตรวจ hint เพื่อระบุ reason ให้ชัด (log เท่านั้น ไม่ใช้ตัดสินใจ)
  const hint = THIRD_PARTY_HINTS.find((kw) => normalized.includes(kw));
  if (hint) {
    return {
      policy: SourcePolicy.NEEDS_REVIEW,
      reason: `third_party:${hint}`,
    };
  }
  return {
    policy: SourcePolicy.NEEDS_REVIEW,
    reason: "unrecognized_source",
  };
}

/**
 * กรองรายการข่าวออกเป็นสองกลุ่ม:
 *   - canProcess: TRUSTED (ส่งเข้า OpenAI ได้)
 *   - blocked:    NEEDS_REVIEW (ห้ามส่งอัตโนมัติ)
 *
 * @returns {{ canProcess: News[], blocked: Array<{news, policy, reason}> }}
 */
export function partitionByPolicy(newsList) {
  const canProcess = [];
  const blocked = [];
  for (const news of newsList) {
    const r = classifySource(news);
    if (r.policy === SourcePolicy.TRUSTED) {
      canProcess.push(news);
    } else {
      blocked.push({ news, policy: r.policy, reason: r.reason });
    }
  }
  return { canProcess, blocked };
}

// export เพื่อให้ test เข้าถึงได้
export const __TRUSTED_SOURCES = TRUSTED_SOURCES;
