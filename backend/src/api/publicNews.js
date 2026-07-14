const HIGH_IMPACT = /\b(fed|fomc|cpi|inflation|interest rate|rate cut|rate hike|powell|war|tariff)\b/i;
const GOLD_TOPIC = /\b(gold|silver|bullion|precious metal|xau)\b/i;

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
  const content = Array.isArray(news.thaiContent)
    ? news.thaiContent
    : text(news.thaiContent)
      ? [news.thaiContent]
      : [];
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

  return {
    id: news.id,
    slug: news.id,
    category: publicCategory(news),
    title,
    excerpt: summary,
    cover: text(news.imageUrl),
    source: text(news.credit) || text(news.source) || "Kitco",
    sourceUrl: text(news.sourceUrl),
    publishedAt: news.publishedAt || news.originalPublishedAt || news.createdAt,
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
