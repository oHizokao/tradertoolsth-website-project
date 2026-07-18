const HIGH_IMPACT = /\b(fed|fomc|cpi|inflation|interest rate|rate cut|rate hike|powell|war|tariff)\b/i;
const GOLD_TOPIC = /\b(gold|silver|bullion|precious metal|xau)\b/i;

import { toBangkokString } from "../utils/date.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function publicCategory(news) {
  const haystack = [news.category, news.section, ...(news.topics || []), news.originalTitle]
    .filter(Boolean)
    .join(" ");
  return GOLD_TOPIC.test(haystack) ? "gold" : "forex";
}

function bodyBlocks(news) {
  let content = Array.isArray(news.thaiContent)
    ? news.thaiContent
    : text(news.thaiContent)
      ? [news.thaiContent]
      : [];
  // Auto Pilot soft-gate: ถ้า rewrite ล้มเหลวแต่ต้นฉบับยังอ่านได้
  // ให้เผยแพร่ต้นฉบับพร้อมคำเตือนฝั่ง Admin แทนหน้าข่าวว่าง
  if (!content.some((part) => text(typeof part === "string" ? part : part?.text))) {
    content = text(news.originalContent) ? [news.originalContent] : [];
  }
  return content
    .map((part) => (typeof part === "string" ? part : part?.text))
    .map(text)
    .filter(Boolean)
    .map((paragraph) => ({ type: "p", text: paragraph }));
}

function readMinutes(news) {
  const chars = bodyBlocks(news).reduce((sum, block) => sum + block.text.length, 0);
  return Math.max(1, Math.ceil(chars / 700));
}

export function toPublicNews(news) {
  if (!news) return null;
  const title = text(news.thaiTitle) || text(news.originalTitle);
  const summary = text(news.thaiSummary) || text(news.teaser);
  const impactText = [news.originalTitle, news.thaiTitle, ...(news.topics || [])]
    .filter(Boolean)
    .join(" ");
  const impact = HIGH_IMPACT.test(impactText) ? "high" : "medium";
  const factors = Array.isArray(news.marketFactors)
    ? news.marketFactors.join(" • ")
    : text(news.marketFactors);

  // Phase 8: เวลาเผยแพร่จริงจาก Kitco (sourcePublishedAt) เป็นตัวเรียง/แสดงหลัก
  // - publishedAt (ใน output) = sourcePublishedAt เท่านั้น (ห้าม fallback ไป createdAt/publishedAt)
  //   หาก null ก็ null — แต่ repo.listAllPublished กรอง sourcePublishedAt IS NOT NULL อยู่แล้ว
  //   จึงไม่มีทางส่งข่าวที่ไม่มี sourcePublishedAt ออก public API
  // - importedAt = เวลาที่ระบบนำเข้า (createdAt) — ข้อมูลภายใน ไม่ใช่ตัวเรียง
  const sourcePublishedAt = news.sourcePublishedAt || null;

  return {
    id: news.id,
    slug: news.id,
    category: publicCategory(news),
    title,
    excerpt: summary,
    cover: text(news.imageUrl),
    source: text(news.credit) || text(news.source) || "Kitco",
    sourceUrl: text(news.sourceUrl),
    // ใช้ sourcePublishedAt เท่านั้น (no fallback) — frontend เรียง/แสดงตามค่านี้
    publishedAt: sourcePublishedAt,
    sourcePublishedAt,
    sourcePublishedAtLabel: toBangkokString(sourcePublishedAt),
    // เวลาที่ระบบนำเข้า — แสดงแยกเป็นข้อมูลภายใน ไม่ใช่ตัวเรียงหลัก
    importedAt: news.createdAt || null,
    impact,
    readMinutes: readMinutes(news),
    body: bodyBlocks(news),
    impactOnMarket: factors,
    imageCredit: {
      source: text(news.imageSource),
      author: text(news.imageAuthor),
      authorUrl: text(news.imageAuthorUrl),
      license: text(news.imageLicense),
      sourceUrl: text(news.imageSourceUrl),
    },
  };
}
