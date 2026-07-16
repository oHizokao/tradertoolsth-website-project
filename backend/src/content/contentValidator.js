/* ============================================================
   Content Validation — sanitize + validate ข้อมูลก่อนเข้า repository
   ------------------------------------------------------------
   กฎ QC (safety):
   - slug ต้องเป็น [a-z0-9-] เท่านั้น (กัน path traversal + injection)
   - ทุก string ตัด length cap (กัน abuse)
   - ค่า enum (status/type/platform) ต้องอยู่ใน whitelist
   - price/score ต้องเป็น number ในช่วงที่กำหนด
   - ห้ามรับ raw path/URL ที่อาจเป็น path traversal
   ============================================================ */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** whitelist ค่า enum */
export const CONTENT_ENUMS = Object.freeze({
  status: ["draft", "published"],
  eaType: ["free", "paid"],
  eaPlatform: ["mt4", "mt5", "both"],
});

/** cap length ของ string fields (กัน abuse) */
export const CONTENT_LIMITS = Object.freeze({
  name: 200,
  title: 300,
  slug: 120,
  question: 400,
  answer: 2000,
  shortText: 500, // description, excerpt, category, spread, commission ฯลฯ
  longText: 8000, // overview, body, description ยาว
  referenceUrl: 1000,
  coverImage: 500,
  filePath: 500,
  fileName: 200,
  fileMime: 100,
  logoColor: 30,
  license: 200,
});

/** ตัด length + แปลงเป็น string trim */
function str(value, max) {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  return max ? s.slice(0, max) : s;
}

/** parse number ในช่วง min..max, default ถ้า invalid */
function num(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** parse int ในช่วง min..max, default ถ้า invalid */
function int(value, min, max, fallback = 0) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** แปลง array ของ strings ให้ปลอดภัย (trim + cap แต่ละ item + จำกัดจำนวน) */
function strArray(value, itemMax = 300, maxItems = 50) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => str(v, itemMax))
    .filter(Boolean)
    .slice(0, maxItems);
}

/** validate slug — ต้องเป็น [a-z0-9-] ติดกันเท่านั้น (กัน path traversal/injection) */
export function isValidSlug(slug) {
  const s = str(slug, CONTENT_LIMITS.slug);
  return SLUG_RE.test(s) && s.length >= 1 && s.length <= CONTENT_LIMITS.slug;
}

/** sanitize slug (normalize) — ไม่ validate (ใช้กับ auto-generate) */
export function sanitizeSlug(input) {
  if (!input) return "";
  let s = str(input, CONTENT_LIMITS.slug)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-") // ทุก non-alphanumeric → dash
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s.slice(0, CONTENT_LIMITS.slug);
}

/** ตรวจค่า enum ต้องอยู่ใน whitelist */
export function isValidEnum(value, list) {
  return list.includes(value);
}

/* ============================================================
   Sanitizers สำหรับแต่ละ content type
   ------------------------------------------------------------
   - return null เมื่อ required field หาย/ผิด format
   - return { ...sanitized, __error?: string } เสมอ (caller เช็ค error)
   ============================================================ */

/** ทำให้ reference URL ปลอดภัย (เฉพาะ http/https, กัน javascript: data: ฯลฯ) */
export function sanitizeHttpUrl(value) {
  const s = str(value, CONTENT_LIMITS.referenceUrl);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return ""; // อนุญาตเฉพาะ http/https เท่านั้น
  return s;
}

/** sanitize path ที่จะเก็บเป็น file path (relative เท่านั้น, ห้าม ..) */
export function sanitizeRelativePath(value) {
  const s = str(value, CONTENT_LIMITS.filePath);
  if (!s) return "";
  // ห้าม absolute, ห้าม .., ห้าม backslash นำหน้า
  if (/^[/\\]/.test(s) || /(^|[/\\])\.\.([/\\]|$)/.test(s)) return "";
  return s;
}

/** validate + sanitize EA product input */
export function sanitizeEaInput(input = {}) {
  const out = {};
  const errors = [];

  const name = str(input.name, CONTENT_LIMITS.name);
  if (!name) errors.push("name_required");
  out.name = name;

  const slug = str(input.slug, CONTENT_LIMITS.slug);
  // slug ถ้าใส่มาต้อง valid; ถ้าไม่ใส่ caller จะ generate ให้
  if (slug && !isValidSlug(slug)) errors.push("slug_invalid");
  out.slug = slug;

  out.description = str(input.description, CONTENT_LIMITS.longText);
  out.version = str(input.version, CONTENT_LIMITS.shortText);

  const platform = str(input.platform, 10).toLowerCase();
  if (platform && !isValidEnum(platform, CONTENT_ENUMS.eaPlatform)) {
    errors.push("platform_invalid");
  }
  out.platform = platform || "mt5";

  const price = num(input.price, 0, 1_000_000, 0);
  out.price = price;

  const type = str(input.type, 10).toLowerCase();
  if (type && !isValidEnum(type, CONTENT_ENUMS.eaType)) {
    errors.push("type_invalid");
  }
  // free → price must be 0; paid → price must be > 0
  const resolvedType = type || (price > 0 ? "paid" : "free");
  if (resolvedType === "free" && price > 0) errors.push("free_must_zero_price");
  if (resolvedType === "paid" && price <= 0) errors.push("paid_requires_price");
  out.type = resolvedType;

  const status = str(input.status, 20).toLowerCase();
  if (status && !isValidEnum(status, CONTENT_ENUMS.status)) errors.push("status_invalid");
  out.status = status || "draft";

  // file/cover paths (relative, ปลอดภัย) — caller ตั้งหลัง upload
  out.filePath = sanitizeRelativePath(input.filePath) || "";
  out.fileName = str(input.fileName, CONTENT_LIMITS.fileName);
  out.fileSize = int(input.fileSize, 0, 1024 * 1024 * 1024, null);
  if (out.fileSize === null && input.fileSize !== undefined && input.fileSize !== null) {
    out.fileSize = 0;
  }
  out.fileMime = str(input.fileMime, CONTENT_LIMITS.fileMime);
  out.coverImage = sanitizeRelativePath(input.coverImage) || "";

  out.sortOrder = int(input.sortOrder, 0, 100000, 0);

  return errors.length ? { __error: errors.join(",") } : out;
}

/** validate + sanitize knowledge article input */
export function sanitizeArticleInput(input = {}) {
  const out = {};
  const errors = [];

  const title = str(input.title, CONTENT_LIMITS.title);
  if (!title) errors.push("title_required");
  out.title = title;

  const slug = str(input.slug, CONTENT_LIMITS.slug);
  if (slug && !isValidSlug(slug)) errors.push("slug_invalid");
  out.slug = slug;

  out.excerpt = str(input.excerpt, CONTENT_LIMITS.shortText);
  // body: เก็บเป็น JSON array ของ blocks (stringify ที่ caller) — sanitize แต่ละ block
  const bodyArr = Array.isArray(input.body) ? input.body : [];
  const sanitizedBody = bodyArr
    .map((block) => {
      if (!block || typeof block !== "object") return null;
      const type = str(block.type, 20);
      if (!["p", "h2", "h3", "ul", "ol", "quote"].includes(type)) return null;
      const text = str(block.text, CONTENT_LIMITS.longText);
      const items = strArray(block.items, CONTENT_LIMITS.shortText, 50);
      if (type === "ul" || type === "ol") {
        if (!items.length) return null;
        return { type, items };
      }
      if (!text) return null;
      return { type, text };
    })
    .filter(Boolean);
  out.body = sanitizedBody;
  out.category = str(input.category, CONTENT_LIMITS.shortText);
  out.readMinutes = int(input.readMinutes, 0, 600, 0);

  out.coverImage = sanitizeRelativePath(input.coverImage) || "";

  const status = str(input.status, 20).toLowerCase();
  if (status && !isValidEnum(status, CONTENT_ENUMS.status)) errors.push("status_invalid");
  out.status = status || "draft";

  out.sortOrder = int(input.sortOrder, 0, 100000, 0);

  return errors.length ? { __error: errors.join(",") } : out;
}

/** validate + sanitize FAQ input */
export function sanitizeFaqInput(input = {}) {
  const out = {};
  const errors = [];

  const question = str(input.question, CONTENT_LIMITS.question);
  if (!question) errors.push("question_required");
  out.question = question;

  const answer = str(input.answer, CONTENT_LIMITS.answer);
  if (!answer) errors.push("answer_required");
  out.answer = answer;

  out.category = str(input.category, CONTENT_LIMITS.shortText);

  const status = str(input.status, 20).toLowerCase();
  if (status && !isValidEnum(status, CONTENT_ENUMS.status)) errors.push("status_invalid");
  out.status = status || "draft";

  out.sortOrder = int(input.sortOrder, 0, 100000, 0);

  return errors.length ? { __error: errors.join(",") } : out;
}

/** validate + sanitize broker review input */
export function sanitizeBrokerInput(input = {}) {
  const out = {};
  const errors = [];

  const name = str(input.name, CONTENT_LIMITS.name);
  if (!name) errors.push("name_required");
  out.name = name;

  const slug = str(input.slug, CONTENT_LIMITS.slug);
  if (slug && !isValidSlug(slug)) errors.push("slug_invalid");
  out.slug = slug;

  out.shortName = str(input.shortName, 20);
  out.overview = str(input.overview, CONTENT_LIMITS.longText);

  out.rating = num(input.rating, 0, 5, 0);
  out.score = num(input.score, 0, 100, 0);
  out.logoColor = str(input.logoColor, CONTENT_LIMITS.logoColor);
  out.license = str(input.license, CONTENT_LIMITS.license);
  out.regulation = strArray(input.regulation, CONTENT_LIMITS.shortText, 30);
  out.spread = str(input.spread, CONTENT_LIMITS.shortText);
  out.commission = str(input.commission, CONTENT_LIMITS.shortText);
  out.depositWithdraw = str(input.depositWithdraw, CONTENT_LIMITS.shortText);
  out.platform = strArray(input.platform, 30, 20);
  out.minDeposit = int(input.minDeposit, 0, 1_000_000_000, null);
  if (out.minDeposit === null && input.minDeposit !== undefined && input.minDeposit !== null) {
    out.minDeposit = 0;
  }
  out.pros = strArray(input.pros, CONTENT_LIMITS.shortText, 50);
  out.cons = strArray(input.cons, CONTENT_LIMITS.shortText, 50);
  out.suitableFor = str(input.suitableFor, CONTENT_LIMITS.shortText);
  out.affiliateDisclosure = str(input.affiliateDisclosure, CONTENT_LIMITS.shortText);
  out.referenceUrl = sanitizeHttpUrl(input.referenceUrl);
  out.coverImage = sanitizeRelativePath(input.coverImage) || "";

  // reviewedAt — รับ ISO date เท่านั้น (YYYY-MM-DD หรือ full ISO); ห้ามรับค่าอื่น
  const reviewedAt = str(input.reviewedAt, 40);
  if (reviewedAt && !/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(reviewedAt)) {
    errors.push("reviewed_at_invalid");
  }
  out.reviewedAt = reviewedAt;

  const status = str(input.status, 20).toLowerCase();
  if (status && !isValidEnum(status, CONTENT_ENUMS.status)) errors.push("status_invalid");
  out.status = status || "draft";

  out.sortOrder = int(input.sortOrder, 0, 100000, 0);

  return errors.length ? { __error: errors.join(",") } : out;
}
