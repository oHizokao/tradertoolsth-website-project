/* ============================================================
   News Repository — CRUD + dedup + status แยก (Phase 5)
   ------------------------------------------------------------
   กฎสำคัญ (QC):
   - original_content ไม่ UNIQUE
   - duplicate detection ผ่าน source_url + duplicate_hash (ไม่ใช่ DB constraint)
   - dedup check + insert ใน transaction เดียวกัน (กัน race condition)
   - validation_status แยกจาก publish_status ตลอด
   - ทุก query ใช้ parameterized (? placeholders) เท่านั้น
   ============================================================ */

import { logger } from "../utils/logger.js";
import { newsToRow, rowToNews } from "./newsMapper.js";
import { normalizeUrlAlias } from "../utils/hash.js";

const log = logger.make("repo");

// INSERT column list (idempotent via ON CONFLICT DO NOTHING)
const INSERT_COLUMNS = [
  "id", "source", "source_url", "original_title", "original_author",
  "original_published_at", "source_published_at", "category", "original_content",
  "thai_title", "thai_summary", "thai_content", "market_factors",
  "key_facts", "mentioned_numbers", "credit",
  "image_url", "image_source", "image_author", "image_author_url",
  "image_license", "image_source_url", "image_search_keywords",
  "image_status", "image_review_required",
  "validation_status", "publish_status", "ai_confidence", "ai_validation",
  "duplicate_hash", "source_policy", "source_policy_reason",
  "topics", "section", "teaser", "is_external", "pipeline_note",
  "created_at", "updated_at", "validated_at", "published_at",
];
const INSERT_PLACEHOLDERS = INSERT_COLUMNS.map(() => "?").join(", ");

/**
 * สร้าง repository bound กับ db instance
 * @param {Database} db
 */
export function createNewsRepository(db) {
  // ---- INSERT ----
  const insertStmt = db.prepare(
    `INSERT INTO news (${INSERT_COLUMNS.join(", ")}) ` +
      `VALUES (${INSERT_PLACEHOLDERS}) ` +
      `ON CONFLICT(id) DO NOTHING`
  );

  /** บันทึกข่าวใหม่ (ถ้า id ซ้ำ → ข้าม, คืน inserted=false) */
  function insertNews(news) {
    const row = newsToRow(news);
    const params = INSERT_COLUMNS.map((c) => row[c]);
    const info = insertStmt.run(...params);
    const inserted = info.changes > 0;
    log.debug(`insertNews id=${news.id} inserted=${inserted}`);
    return { inserted, id: news.id };
  }

  // ---- QUERY helpers ----
  const getByIdStmt = db.prepare("SELECT * FROM news WHERE id = ?");
  const getBySourceUrlStmt = db.prepare(
    "SELECT * FROM news WHERE source_url = ? LIMIT 1"
  );
  const getByDupHashStmt = db.prepare(
    "SELECT * FROM news WHERE duplicate_hash = ? LIMIT 1"
  );
  const getPublishedByIdStmt = db.prepare(
    "SELECT * FROM news WHERE id = ? AND publish_status = 'published' LIMIT 1"
  );

  function getById(id) {
    return rowToNews(getByIdStmt.get(id));
  }
  function getBySourceUrl(sourceUrl) {
    if (!sourceUrl) return null;
    return rowToNews(getBySourceUrlStmt.get(sourceUrl));
  }
  function getByDuplicateHash(hash) {
    if (!hash) return null;
    return rowToNews(getByDupHashStmt.get(hash));
  }
  function getPublishedById(id) {
    return rowToNews(getPublishedByIdStmt.get(id));
  }

  /**
   * ตรวจข่าวซ้ำด้วย sourceUrl + duplicateHash
   * (ไม่ใช้ UNIQUE constraint — ตามกฎ QC)
   * @returns { { isDuplicate: boolean, reason?: string, matchId?: string, match?: object } }
   */
  function findDuplicate(news) {
    // 1) source_url match (normalize ก่อน)
    if (news.sourceUrl) {
      const target = normalizeUrlAlias(news.sourceUrl);
      // scan rows ที่มี source_url (index ช่วย) — compare normalized
      const row = getBySourceUrlStmt.get(news.sourceUrl);
      if (row) {
        return {
          isDuplicate: true,
          reason: "same_source_url",
          matchId: row.id,
          match: rowToNews(row),
        };
      }
      // ลอง normalized compare (กัน trailing slash / scheme ต่าง)
      const all = db
        .prepare("SELECT id, source_url FROM news WHERE source_url IS NOT NULL")
        .all();
      for (const r of all) {
        if (normalizeUrlAlias(r.source_url) === target) {
          return {
            isDuplicate: true,
            reason: "same_source_url_normalized",
            matchId: r.id,
          };
        }
      }
    }
    // 2) duplicate_hash match
    if (news.duplicateHash) {
      const row = getByDupHashStmt.get(news.duplicateHash);
      if (row) {
        return {
          isDuplicate: true,
          reason: "same_duplicate_hash",
          matchId: row.id,
          match: rowToNews(row),
        };
      }
    }
    return { isDuplicate: false };
  }

  /**
   * บันทึกข่าวใน transaction เดียวกับ dedup check
   * (กัน race: ระหว่าง check → insert ไม่มีโอกาส insert ซ้ำ)
   *
   * @returns { { saved: boolean, duplicate: boolean, reason?: string, id: string } }
   */
  function saveWithDedup(news) {
    const tx = db.transaction(() => {
      const dup = findDuplicate(news);
      if (dup.isDuplicate) {
        return { saved: false, duplicate: true, reason: dup.reason, id: news.id, matchId: dup.matchId };
      }
      const { inserted } = insertNews(news);
      // inserted=false เมื่อ id PK ซ้ำ (fallback dedup)
      return {
        saved: inserted,
        duplicate: !inserted,
        reason: inserted ? null : "same_id_pk",
        id: news.id,
      };
    });
    return tx();
  }

  // ---- STATUS UPDATES (แยก validation/publish) ----

  /**
   * อัปเดต validation_status + validatedAt (ถ้า status=validated)
   * ไม่แตะ publish_status
   */
  const updateValidationStmt = db.prepare(
    "UPDATE news SET validation_status = ?, validated_at = ?, updated_at = ?, pipeline_note = ? WHERE id = ?"
  );
  function updateValidationStatus(id, status, note = null) {
    const validatedAt =
      status === "validated" ? new Date().toISOString() : null;
    const now = new Date().toISOString();
    const info = updateValidationStmt.run(status, validatedAt, now, note, id);
    return info.changes > 0;
  }

  /**
   * อัปเดต publish_status + publishedAt
   * ใช้สำหรับ explicit publish action (Phase ถัดไป — Phase 5 ไม่ auto publish)
   */
  const updatePublishStmt = db.prepare(
    `UPDATE news
     SET publish_status = ?, published_at = ?, updated_at = ?
     WHERE id = ?
       AND (? <> 'published' OR validation_status = 'validated')`
  );
  function updatePublishStatus(id, status) {
    const publishedAt =
      status === "published" ? new Date().toISOString() : null;
    const now = new Date().toISOString();
    const info = updatePublishStmt.run(status, publishedAt, now, id, status);
    return info.changes > 0;
  }

  /**
   * อัปเดต image metadata (หลัง findImageForNews)
   * ไม่แตะ validation/publish status
   */
  const updateImageStmt = db.prepare(
    `UPDATE news SET
      image_url = ?, image_source = ?, image_author = ?,
      image_author_url = ?, image_license = ?, image_source_url = ?,
      image_search_keywords = ?, image_status = ?, image_review_required = ?,
      updated_at = ?
    WHERE id = ?`
  );
  function updateImage(id, imageMeta) {
    const now = new Date().toISOString();
    const info = updateImageStmt.run(
      imageMeta.imageUrl ?? null,
      imageMeta.imageSource ?? null,
      imageMeta.imageAuthor ?? null,
      imageMeta.imageAuthorUrl ?? null,
      imageMeta.imageLicense ?? null,
      imageMeta.imageSourceUrl ?? null,
      JSON.stringify(imageMeta.imageSearchKeywords || []),
      imageMeta.imageStatus ?? null,
      imageMeta.imageReviewRequired ? 1 : 0,
      now,
      id
    );
    return info.changes > 0;
  }

  const updateReviewedStmt = db.prepare(
    `UPDATE news SET
      thai_title = ?, thai_summary = ?, thai_content = ?, market_factors = ?,
      key_facts = ?, mentioned_numbers = ?, credit = ?,
      validation_status = 'validated', publish_status = 'ready',
      ai_confidence = ?, ai_validation = ?, pipeline_note = ?,
      image_url = ?, image_source = ?, image_author = ?, image_author_url = ?,
      image_license = ?, image_source_url = ?, image_status = ?,
      image_review_required = ?, validated_at = ?, published_at = NULL, updated_at = ?
     WHERE id = ?`
  );
  function saveManualReview(id, reviewed, localCheck, imageMeta, audit) {
    const now = new Date().toISOString();
    const validation = {
      isValid: true,
      method: "manual_source_review_plus_deterministic_checks",
      reviewer: audit.reviewer,
      sourceCheckedAt: now,
      numberCheck: localCheck.numberCheck,
      bannedWordsFound: localCheck.bannedWords,
      investmentAdviceFound: localCheck.adviceWords.length > 0,
      confidence: 100,
      notes: audit.notes || "ตรวจเทียบต้นฉบับแล้ว",
    };
    const info = updateReviewedStmt.run(
      reviewed.thaiTitle, reviewed.thaiSummary,
      JSON.stringify(reviewed.thaiContent || []), reviewed.marketFactors || "",
      JSON.stringify(reviewed.keyFacts || []), JSON.stringify(reviewed.mentionedNumbers || []),
      reviewed.credit || "อ้างอิงข้อมูลจาก Kitco News — เรียบเรียงใหม่โดย TraderToolsTH",
      100, JSON.stringify(validation),
      `manual_source_review:${audit.reviewer}`,
      imageMeta.imageUrl, imageMeta.imageSource, imageMeta.imageAuthor,
      imageMeta.imageAuthorUrl, imageMeta.imageLicense, imageMeta.imageSourceUrl,
      imageMeta.status, imageMeta.reviewRequired ? 1 : 0,
      now, now, id
    );
    return info.changes > 0;
  }

  /** มี image metadata ที่ใช้ได้แล้ว (กันเรียก Pexels ซ้ำ) */
  const hasUsableImageStmt = db.prepare(
    "SELECT image_url FROM news WHERE id = ?"
  );
  function hasUsableImage(id) {
    const r = hasUsableImageStmt.get(id);
    return !!(r && r.image_url);
  }

  // ---- LIST / COUNT ----
  function listByStatus(status, limit = 100) {
    const rows = db
      .prepare(
        "SELECT * FROM news WHERE validation_status = ? ORDER BY created_at DESC LIMIT ?"
      )
      .all(status, limit);
    return rows.map(rowToNews);
  }
  function listByPublishStatus(status, limit = 100) {
    const rows = db
      .prepare(
        "SELECT * FROM news WHERE publish_status = ? ORDER BY created_at DESC LIMIT ?"
      )
      .all(status, limit);
    return rows.map(rowToNews);
  }
  function listPublished(limit = 100, offset = 0) {
    const rows = db
      .prepare(
        `SELECT * FROM news
         WHERE publish_status = 'published'
           AND validation_status = 'validated'
           AND source_published_at IS NOT NULL
         ORDER BY source_published_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset);
    return rows.map(rowToNews);
  }
  function listAll(limit = 100, offset = 0) {
    const rows = db
      .prepare("SELECT * FROM news ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset);
    return rows.map(rowToNews);
  }

  function countByStatus() {
    const rows = db
      .prepare(
        "SELECT validation_status AS status, COUNT(*) AS cnt FROM news GROUP BY validation_status"
      )
      .all();
    const out = {};
    for (const r of rows) out[r.status] = r.cnt;
    return out;
  }
  function countAll() {
    return db.prepare("SELECT COUNT(*) AS n FROM news").get().n;
  }
  function countPublished() {
    return db
      .prepare(
        "SELECT COUNT(*) AS n FROM news WHERE publish_status = 'published' AND validation_status = 'validated'"
      )
      .get().n;
  }
  /**
   * นับข่าวแยกตาม publish_status → { published, ready, processing, draft, rejected, failed }
   * ใช้สำหรับ Admin Dashboard stats (ตามแกน publish_status ไม่ใช่ validation_status)
   */
  function countByPublishStatus() {
    const rows = db
      .prepare(
        "SELECT publish_status AS status, COUNT(*) AS cnt FROM news GROUP BY publish_status"
      )
      .all();
    const out = {};
    for (const r of rows) out[r.status] = r.cnt;
    return out;
  }
  /**
   * นับข่าวแยกตาม image_status → { selected, fallback, failed }
   * ใช้สำหรับ Admin Dashboard ให้เห็นภาพรวมของรูปข่าว (requirement ข้อ 5)
   * - selected = ได้รูปจริงจาก Pexels (หรือ owned placeholder ของ manual review)
   * - fallback = ไม่มี Pexels key / ไม่มีรูพผ่านเกณฑ์ → ต้องตรวจ
   * - failed = Pexels API ล้มเหลวทุก retry → ต้องตรวจ
   */
  function countByImageStatus() {
    const rows = db
      .prepare(
        "SELECT image_status AS status, COUNT(*) AS cnt FROM news WHERE image_status IS NOT NULL GROUP BY image_status"
      )
      .all();
    const out = {};
    for (const r of rows) out[r.status] = r.cnt;
    return out;
  }
  /** นับข่าวที่ต้องตรวจรูป (image_review_required = 1) */
  function countImageReviewRequired() {
    return db
      .prepare(
        "SELECT COUNT(*) AS n FROM news WHERE image_review_required = 1"
      )
      .get().n;
  }
  /** นับเฉพาะรูปที่มาจาก Pexels จริง ไม่รวม owned placeholder ที่มี status=selected */
  function countPexelsImages() {
    return db
      .prepare(
        "SELECT COUNT(*) AS n FROM news WHERE image_status = 'selected' AND image_source = 'Pexels'"
      )
      .get().n;
  }
  /** Count owned fallback artwork, including manually-approved legacy rows. */
  function countOwnedFallbackImages() {
    return db
      .prepare(
        "SELECT COUNT(*) AS n FROM news WHERE image_source = 'TraderToolsTH'"
      )
      .get().n;
  }
  /**
   * ข่าว published ล่าสุดตาม "เวลาที่กด publish" (published_at)
   * ต่างจาก listPublished ซึ่งเรียงตาม source_published_at (เวลาข่าวต้นทาง)
   * ใช้สำหรับ rollback ข่าวที่เพิ่งเผยแพร่
   */
  function listLatestPublished(limit = 1) {
    const rows = db
      .prepare(
        `SELECT * FROM news
         WHERE publish_status = 'published' AND published_at IS NOT NULL
         ORDER BY published_at DESC
         LIMIT ?`
      )
      .all(Math.max(1, Math.min(100, Math.floor(limit))));
    return rows.map(rowToNews);
  }

  /**
   * ดึงข่าว published ทั้งหมด (เรียงใหม่ → เก่า) โดยไม่ตัด limit/offset
   * ใช้สำหรับ public API เพื่อให้ category filter + pagination คำนวณได้ถูกต้อง
   * หากแค่ listPublished(limit,offset) ก่อน filter → offset จะนับจากข่าวทุกหมวด ทำให้ผลลัพธ์ผิด
   *
   * QC (Phase 8 — no fallback):
   * - เฉพาะ publish_status='published' AND validation_status='validated'
   * - ต้องมี source_published_at (WHERE IS NOT NULL) — ข่าวที่ไม่มีเวลาต้นทาง
   *   จะไม่ปรากฏใน public listing (ห้ามใช้ createdAt/publishedAt แทน)
   * - เรียง source_published_at DESC เท่านั้น
   * - draft / ready / rejected / processing / failed ไม่ถูกส่งออก
   */
  function listAllPublished() {
    const rows = db
      .prepare(
        `SELECT * FROM news
         WHERE publish_status = 'published'
           AND validation_status = 'validated'
           AND source_published_at IS NOT NULL
         ORDER BY source_published_at DESC`
      )
      .all();
    return rows.map(rowToNews);
  }

  // ---- สำหรับ test/debug ----
  function clearAll() {
    db.prepare("DELETE FROM news").run();
  }

  return {
    // insert
    insertNews,
    saveWithDedup,
    findDuplicate,
    // query
    getById,
    getBySourceUrl,
    getByDuplicateHash,
    getPublishedById,
    listByStatus,
    listByPublishStatus,
    listPublished,
    listAllPublished,
    listAll,
    countByStatus,
    countAll,
    countPublished,
    countByPublishStatus,
    countByImageStatus,
    countImageReviewRequired,
    countPexelsImages,
    countOwnedFallbackImages,
    listLatestPublished,
    // updates (status แยก)
    updateValidationStatus,
    updatePublishStatus,
    updateImage,
    saveManualReview,
    hasUsableImage,
    // debug
    clearAll,
  };
}

export { INSERT_COLUMNS };
