/* ============================================================
   Image Keywords — สร้าง search keyword สำหรับ Pexels
   ------------------------------------------------------------
   ลำดับ:
   1. ใช้ imageSearchKeywords จาก AI rewriter (ถ้ามี)
   2. ต่อด้วย keyword จาก static topic map ตาม category/title
   3. normalize + dedupe + จำกัดสูงสุด MAX_KEYWORDS

   ข้อจำกัด:
   - ห้ามส่งเนื้อหาข่าวทั้งหมดไป Pexels
   - keyword ต้องเป็นคำค้นภาษาอังกฤษสั้นๆ (ไม่เกิน 5 คำ/keyword)
   - ห้ามสร้าง keyword ที่มีตัวเลขราคาหรือข้อมูลเฉพาะเจาะจง
     (Pexels ค้นหาตามภาพ ไม่ใช่เนื้อหา)
   ============================================================ */

const MAX_KEYWORDS = 5;

// Static keyword map ตาม topic/category
// ใช้เป็น fallback ถ้า AI keywords ไม่เพียงพอ
const TOPIC_MAP = [
  {
    patterns: [/\bgold\b/i, /\bทอง/],
    keywords: ["gold bars", "gold bullion market"],
  },
  {
    patterns: [/\bsilver\b/i, /\bเงิน(?:แท่ง|คำ)/],
    keywords: ["silver coins", "precious metals"],
  },
  {
    patterns: [
      /\bcentral bank\b/i,
      /\bfederal reserve\b/i,
      /\bfed\b/i,
      /\bfomc\b/i,
    ],
    keywords: ["Federal Reserve building", "central bank monetary policy"],
  },
  {
    patterns: [/\binflation\b/i, /\bcpi\b/i, /\bเงินเฟ้อ/],
    keywords: ["inflation economy prices", "consumer price index"],
  },
  {
    patterns: [/\binterest rate\b/i, /\brate hike\b/i, /\bดอกเบี้ย/],
    keywords: ["interest rate bank finance", "monetary policy"],
  },
  {
    patterns: [/\bmining\b/i, /\bmine\b/i, /\bขุด/],
    keywords: ["gold mining operation", "silver mine"],
  },
  {
    patterns: [/\bdollar\b/i, /\busd\b/i, /\bdxy\b/i],
    keywords: ["US dollar currency", "forex trading"],
  },
  {
    patterns: [/\bcopper\b/i, /\bทองแดง/],
    keywords: ["copper metal industrial"],
  },
  {
    patterns: [/\bplatinum\b/i, /\bpalladium\b/i],
    keywords: ["platinum precious metal"],
  },
  {
    patterns: [/\boil\b/i, /\bcrude\b/i, /\bน้ำมัน/],
    keywords: ["crude oil barrel energy"],
  },
  {
    patterns: [/\bstock market\b/i, /\bequity\b/i, /\bwall street\b/i],
    keywords: ["stock market trading floor"],
  },
];

// Generic finance fallback ถ้าไม่ match topic ใด
const GENERIC_FINANCE_KEYWORDS = [
  "financial market trading",
  "gold investment",
];

/**
 * Normalize keyword: lowercase, trim, ตัด special chars ส่วนเกิน
 * ยังคง space ระหว่างคำไว้ (ใช้เป็น phrase search)
 */
function normalizeKeyword(kw) {
  return String(kw)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60); // Pexels query limit
}

/**
 * Deduplicate keywords (normalized) รักษาลำดับ
 */
function dedupeKeywords(list) {
  const seen = new Set();
  return list.filter((kw) => {
    const n = normalizeKeyword(kw);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

/**
 * ดึง static keywords ที่ตรงกับ text (title + category)
 * @param {string} text
 * @returns {string[]}
 */
function getTopicKeywords(text) {
  if (!text) return [];
  const matched = [];
  for (const entry of TOPIC_MAP) {
    if (entry.patterns.some((re) => re.test(text))) {
      matched.push(...entry.keywords);
    }
  }
  return matched;
}

/**
 * สร้าง keyword list สำหรับค้นหารูปจาก Pexels
 *
 * ลำดับ: AI keywords → static topic map → generic fallback
 *
 * @param {object} news ต้องมี imageSearchKeywords (array), originalTitle, category
 * @returns {string[]} keyword ที่ normalize แล้ว ≤ MAX_KEYWORDS
 */
export function buildImageKeywords(news) {
  const aiKeywords = Array.isArray(news.imageSearchKeywords)
    ? news.imageSearchKeywords.filter((k) => typeof k === "string" && k.trim())
    : [];

  // text สำหรับ topic match (title + category เท่านั้น ไม่ส่งเนื้อหาทั้งหมด)
  const topicText = [news.originalTitle, news.category].filter(Boolean).join(" ");
  const topicKeywords = getTopicKeywords(topicText);

  // รวมตามลำดับความสำคัญ
  const combined = [...aiKeywords, ...topicKeywords];

  // ถ้ายังน้อยกว่า MAX_KEYWORDS ใส่ generic fallback
  if (combined.length < MAX_KEYWORDS) {
    combined.push(...GENERIC_FINANCE_KEYWORDS);
  }

  // normalize + dedupe + จำกัดจำนวน
  return dedupeKeywords(combined).slice(0, MAX_KEYWORDS);
}

// export สำหรับ test
export const __MAX_KEYWORDS = MAX_KEYWORDS;
export const __TOPIC_MAP = TOPIC_MAP;
export { normalizeKeyword, getTopicKeywords };
