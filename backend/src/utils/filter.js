/* ============================================================
   Filter — กรองเฉพาะข่าวที่เกี่ยวข้องตามที่กำหนด
   ห้ามดึงข่าวทั้งหมดโดยไม่มีตัวกรอง
   ============================================================ */

import { normalizeText } from "./hash.js";

// คำค้นที่บ่งบอกว่าข่าวเกี่ยวข้อง (เป็น substring, case-insensitive)
export const RELEVANT_KEYWORDS = [
  "gold",
  "silver",
  "precious metal",
  "fed",
  "federal reserve",
  "cpi",
  "inflation",
  "interest rate",
  "rate cut",
  "rate hike",
  "bond yield",
  "treasury yield",
  "us dollar",
  "dollar index",
  "dxy",
  "central bank",
  "mining",
  "geopolitic",
  "xau",
  "xag",
  "bullion",
];

/**
 * ตรวจว่าข่าวเกี่ยวข้องหรือไม่
 * เช็คทั้ง title + teaserSnippet + category.name + urlAlias
 */
export function isRelevant(item) {
  const haystack = normalizeText(
    [
      item.title,
      item.teaserSnippet,
      item.teaserHeadline,
      item.category?.name,
      item.urlAlias,
    ]
      .filter(Boolean)
      .join(" ")
  );
  if (!haystack) return false;
  return RELEVANT_KEYWORDS.some((kw) => haystack.includes(normalizeText(kw)));
}

/**
 * ให้ tag หมวดที่ตรงกับเนื้อหา (ใช้ในการแมปภายหลัง)
 */
export function tagTopic(item) {
  const hay = normalizeText(
    [item.title, item.teaserSnippet, item.category?.name].filter(Boolean).join(" ")
  );
  const tags = [];
  if (/\bgold\b|xau|bullion/.test(hay)) tags.push("gold");
  if (/\bsilver\b|xag/.test(hay)) tags.push("silver");
  if (/fed|federal reserve/.test(hay)) tags.push("fed");
  if (/\bcpi\b|inflation/.test(hay)) tags.push("inflation");
  if (/interest rate|rate cut|rate hike/.test(hay)) tags.push("interest-rate");
  if (/bond yield|treasury yield/.test(hay)) tags.push("bond-yield");
  if (/us dollar|dollar index|\bdxy\b/.test(hay)) tags.push("us-dollar");
  if (/central bank/.test(hay)) tags.push("central-bank");
  if (/mining|miner\b/.test(hay)) tags.push("mining");
  if (/geopolitic|war|sanction/.test(hay)) tags.push("geopolitics");
  return tags;
}
