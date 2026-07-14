/* ============================================================
   News Mapper — แปลง News object ↔ DB row
   ------------------------------------------------------------
   - ทุก SQL ใช้ parameterized queries (newsRepository)
   - array/object fields เก็บเป็น JSON string
   - boolean เก็บเป็น 0/1 (image_review_required, is_external)
   ============================================================ */

// ฟิลด์ที่เก็บเป็น JSON array
const JSON_ARRAY_FIELDS = new Set([
  "thaiContent",
  "keyFacts",
  "mentionedNumbers",
  "imageSearchKeywords",
  "topics",
]);

// ฟิลด์ที่เก็บเป็น JSON object
const JSON_OBJECT_FIELDS = new Set(["aiValidation"]);

// ฟิลด์ boolean → 0/1
const BOOL_FIELDS = new Set(["imageReviewRequired", "isExternal"]);

/** แปลง News object → DB row (snake_case + serialize JSON/bool) */
export function newsToRow(news) {
  const safeArr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const row = {
    id: news.id,
    source: news.source ?? "",
    source_url: news.sourceUrl ?? null,
    original_title: news.originalTitle ?? null,
    original_author: news.originalAuthor ?? null,
    original_published_at: news.originalPublishedAt ?? null,
    category: news.category ?? null,
    original_content: news.originalContent ?? null,
    thai_title: news.thaiTitle ?? null,
    thai_summary: news.thaiSummary ?? null,
    thai_content: JSON.stringify(safeArr(news.thaiContent)),
    market_factors: news.marketFactors ?? null,
    key_facts: JSON.stringify(safeArr(news.keyFacts)),
    mentioned_numbers: JSON.stringify(safeArr(news.mentionedNumbers)),
    credit: news.credit ?? null,
    image_url: news.imageUrl ?? null,
    image_source: news.imageSource ?? null,
    image_author: news.imageAuthor ?? null,
    image_author_url: news.imageAuthorUrl ?? null,
    image_license: news.imageLicense ?? null,
    image_source_url: news.imageSourceUrl ?? null,
    image_search_keywords: JSON.stringify(safeArr(news.imageSearchKeywords)),
    image_status: news.imageStatus ?? null,
    image_review_required: news.imageReviewRequired ? 1 : 0,
    validation_status: news.validationStatus,
    publish_status: news.publishStatus,
    ai_confidence: typeof news.aiConfidence === "number" ? news.aiConfidence : null,
    ai_validation: news.aiValidation ? JSON.stringify(news.aiValidation) : null,
    duplicate_hash: news.duplicateHash ?? null,
    source_policy: news.sourcePolicy ?? null,
    source_policy_reason: news.sourcePolicyReason ?? null,
    topics: JSON.stringify(safeArr(news.topics)),
    section: news.section ?? null,
    teaser: news.teaser ?? null,
    is_external: news.isExternal ? 1 : 0,
    pipeline_note: news.pipelineNote ?? null,
    created_at: news.createdAt ?? new Date().toISOString(),
    updated_at: news.updatedAt ?? new Date().toISOString(),
    validated_at: news.validatedAt ?? null,
    published_at: news.publishedAt ?? null,
  };
  return row;
}

/** แปลง DB row → News object (camelCase + parse JSON/bool) */
export function rowToNews(row) {
  if (!row) return null;
  const parseArr = (v) => {
    if (v == null || v === "") return [];
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  };
  const parseObj = (v) => {
    if (v == null || v === "") return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };
  return {
    id: row.id,
    source: row.source,
    sourceUrl: row.source_url,
    originalTitle: row.original_title,
    originalAuthor: row.original_author,
    originalPublishedAt: row.original_published_at,
    category: row.category,
    originalContent: row.original_content,
    thaiTitle: row.thai_title,
    thaiSummary: row.thai_summary,
    thaiContent: parseArr(row.thai_content),
    marketFactors: row.market_factors,
    keyFacts: parseArr(row.key_facts),
    mentionedNumbers: parseArr(row.mentioned_numbers),
    credit: row.credit,
    imageUrl: row.image_url,
    imageSource: row.image_source,
    imageAuthor: row.image_author,
    imageAuthorUrl: row.image_author_url,
    imageLicense: row.image_license,
    imageSourceUrl: row.image_source_url,
    imageSearchKeywords: parseArr(row.image_search_keywords),
    imageStatus: row.image_status,
    imageReviewRequired: !!row.image_review_required,
    validationStatus: row.validation_status,
    publishStatus: row.publish_status,
    aiConfidence: row.ai_confidence,
    aiValidation: parseObj(row.ai_validation),
    duplicateHash: row.duplicate_hash,
    sourcePolicy: row.source_policy,
    sourcePolicyReason: row.source_policy_reason,
    topics: parseArr(row.topics),
    section: row.section,
    teaser: row.teaser,
    isExternal: !!row.is_external,
    pipelineNote: row.pipeline_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    validatedAt: row.validated_at,
    publishedAt: row.published_at,
  };
}

export { JSON_ARRAY_FIELDS, JSON_OBJECT_FIELDS, BOOL_FIELDS };
