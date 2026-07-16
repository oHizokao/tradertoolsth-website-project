/* ============================================================
   Schema — โครงสร้างข้อมูลข่าวตามที่กำหนด
   ทุกฟิลด์ที่ schema ต้องการอยู่ที่นี่ ที่เดียว
   ============================================================ */

// สถานะข่าวตามที่กำหนด
export const NewsStatus = Object.freeze({
  FETCHED: "fetched",
  PROCESSING: "processing",
  VALIDATED: "validated",
  PUBLISHED: "published",
  REJECTED: "rejected",
  NEEDS_REVIEW: "needs_review",
  FAILED: "failed",
});

export const PublishStatus = Object.freeze({
  PROCESSING: "processing",
  DRAFT: "draft",
  READY: "ready",
  PUBLISHED: "published",
  REJECTED: "rejected",
  FAILED: "failed",
});

/**
 * สร้าง object ข่าวเปล่าที่มีทุกฟิลด์ตาม schema
 * ค่า default ปลอดภัย (string ว่าง / null) เพื่อให้ validation ตรวจได้
 */
export function createEmptyNews() {
  const now = new Date().toISOString();
  return {
    // identity
    id: null,
    source: "",
    sourceUrl: "",
    // original (EN)
    originalTitle: "",
    originalAuthor: "",
    originalPublishedAt: null,
    // Phase 8: เวลาเผยแพร่จริงจาก Kitco (ISO UTC) — ตัวเรียงหลัก
    // ห้าม fallback ไป createdAt/publishedAt หาก null
    sourcePublishedAt: null,
    category: "",
    originalContent: "",
    // thai (เรียบเรียงใหม่ — Phase 3)
    thaiTitle: "",
    thaiSummary: "",
    thaiContent: "",
    keyFacts: [],
    mentionedNumbers: [],
    // image (Phase 4)
    imageUrl: "",
    imageSource: "",
    imageAuthor: "",
    imageAuthorUrl: "",
    imageLicense: "",
    imageSourceUrl: "",
    imageSearchKeywords: [],
    // dedup / quality
    duplicateHash: null,
    aiConfidence: null,
    validationStatus: NewsStatus.FETCHED,
    publishStatus: NewsStatus.FETCHED,
    // timestamps
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * ฟิลด์ที่จำเป็นก่อนเผยแพร่ (Phase 5 จะใช้ตรวจเข้มข้นขึ้น)
 * ใน Phase 2 ใช้ตรวจเบื้องต้นว่า scrape ได้ครบไหม
 */
export const REQUIRED_FOR_PUBLISH = [
  "source",
  "sourceUrl",
  "originalTitle",
  "originalContent",
  "originalPublishedAt",
  // Phase 8: ต้องมีเวลาต้นทางจึงจะเผยแพร่ได้ (ห้ามใช้ createdAt/publishedAt แทน)
  "sourcePublishedAt",
];
