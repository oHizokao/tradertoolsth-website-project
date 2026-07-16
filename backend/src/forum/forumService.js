/* ============================================================
   Forum Service — business logic สำหรับ Community Forum
   ------------------------------------------------------------
   รวม: forumRepository + rateLimiter + uploadStore + validation
   เป็นเลเยอร์กลางระหว่าง API handler กับ repository

   กฎ QC:
   - ทุก action ที่เขียน (create topic/reply/edit/delete) ต้องผ่าน authorize
     (author ต้องเป็นเจ้าของเท่านั้น)
   - ทุก action ที่เขียนต้องผ่าน rate limit
   - ทุก input ถูก sanitize ก่อนเก็บ
   - ไม่กระทบ news / auto_pilot / calendar / market
   ============================================================ */

import { createForumRepository } from "../store/forumRepository.js";
import { createRateLimiter } from "./rateLimiter.js";
import { createUploadStore } from "./uploadStore.js";
import {
  sanitizeText,
  sanitizeSingleLine,
  sanitizeBody,
  isValidSlug,
  isValidAuthorId,
  isValidContentId,
  validateUpload,
  sanitizeFileName,
} from "./sanitize.js";

/**
 * สร้าง forum service
 * @param {object} opts {
 *   db, config (forum config), uploadStore?, rateLimiter?, now?
 * }
 */
export function createForumService(opts = {}) {
  const db = opts.db;
  if (!db) throw new Error("forum: db required");
  const cfg = opts.config || {};
  const repo = createForumRepository(db);

  // seed categories idempotent (run once at startup)
  repo.seedCategories();

  const rateLimiter =
    opts.rateLimiter ||
    createRateLimiter({
      windowSeconds: cfg.rateLimitSeconds || 30,
      burst: cfg.rateLimitBurst || 3,
      now: opts.now,
    });

  const uploadStore =
    opts.uploadStore ||
    createUploadStore({
      uploadDir: cfg.uploadDir || "data/forum",
      maxBytes: cfg.uploadMaxBytes || 5 * 1024 * 1024,
      maxFiles: cfg.uploadMaxFiles || 4,
    });

  /* ---------- LIMITS ---------- */
  const LIMITS = {
    titleMaxLength: cfg.titleMaxLength || 200,
    bodyMaxLength: cfg.bodyMaxLength || 10000,
    bodyMinLength: cfg.bodyMinLength || 1,
    nameMaxLength: cfg.nameMaxLength || 40,
    reasonMaxLength: cfg.reasonMaxLength || 500,
  };

  /* ============================================================
     IDENTITY / AUTH
     ============================================================ */

  /**
   * สร้าง guest author ใหม่ + คืน anon token (ส่งกลับ client ครั้งเดียว)
   * @param {string} rawDisplayName
   * @returns {{ ok, author?, anonToken?, error? }}
   */
  function createGuestProfile(rawDisplayName) {
    const displayName = sanitizeSingleLine(rawDisplayName, LIMITS.nameMaxLength);
    if (!displayName || displayName.length < 1) {
      return { ok: false, error: "invalid_display_name" };
    }
    const created = repo.createGuestAuthor(displayName);
    return {
      ok: true,
      author: {
        id: created.id,
        displayName: created.displayName,
        kind: "guest",
      },
      anonToken: created.anonToken,
    };
  }

  /**
   * resolve author จาก anon token (header x-forum-token)
   * @returns {object|null} author (public fields) หรือ null
   */
  function resolveAuthor(anonToken) {
    if (!anonToken) return null;
    const row = repo.getAuthorByToken(anonToken);
    if (!row) return null;
    return {
      id: row.id,
      displayName: row.displayName,
      kind: row.kind,
    };
  }

  /* ============================================================
     CATEGORIES
     ============================================================ */

  function listCategories() {
    const cats = repo.listCategories();
    // enrich: นับ topics ต่อหมวด (visible only)
    return cats.map((c) => ({
      ...c,
      topicCount: repo.countTopics({ categorySlug: c.slug }),
    }));
  }

  function getCategory(slug) {
    if (!isValidSlug(slug)) return null;
    const cat = repo.getCategoryBySlug(slug);
    if (!cat) return null;
    return { ...cat, topicCount: repo.countTopics({ categorySlug: slug }) };
  }

  /* ============================================================
     TOPICS
     ============================================================ */

  /**
   * list topics (public listing)
   * @param {object} opts { categorySlug?, limit, offset, sort, search? }
   */
  function listTopics(opts = {}) {
    const params = {
      limit: opts.limit,
      offset: opts.offset,
      sort: opts.sort,
    };
    if (opts.categorySlug) {
      if (!isValidSlug(opts.categorySlug)) {
        return { items: [], total: 0, limit: 20, offset: 0, hasMore: false };
      }
      params.categorySlug = opts.categorySlug;
    }
    if (opts.search) {
      // cap search term length กัน abuse
      params.search = sanitizeText(opts.search, 200);
    }
    return repo.listTopics(params);
  }

  function getTopic(id, { incrementViews = false } = {}) {
    if (!isValidContentId(id, "ft")) return null;
    if (incrementViews) repo.incrementTopicViews(id);
    const topic = repo.getTopicById(id);
    if (!topic) return null;
    // attach attachments
    const attachments = repo.listAttachmentsByOwner("topic", id);
    return { ...topic, attachments };
  }

  /**
   * create topic (requires authenticated author + rate limit)
   * @returns {{ ok, topic?, error?, status? }}
   */
  function createTopic({ author, categorySlug, title, body }) {
    if (!author || !author.id) {
      return { ok: false, error: "auth_required", status: 401 };
    }
    if (!isValidSlug(categorySlug)) {
      return { ok: false, error: "invalid_category", status: 400 };
    }
    const category = repo.getCategoryBySlug(categorySlug);
    if (!category) {
      return { ok: false, error: "category_not_found", status: 404 };
    }

    const cleanTitle = sanitizeSingleLine(title, LIMITS.titleMaxLength);
    const cleanBody = sanitizeBody(body, LIMITS.bodyMaxLength);
    if (!cleanTitle || cleanTitle.length < 1) {
      return { ok: false, error: "title_required", status: 400 };
    }
    if (!cleanBody || cleanBody.length < LIMITS.bodyMinLength) {
      return { ok: false, error: "body_too_short", status: 400 };
    }

    // rate limit per author
    const rl = rateLimiter.tryConsume(author.id);
    if (!rl.allowed) {
      return {
        ok: false,
        error: "rate_limited",
        status: 429,
        retryAfterMs: rl.retryAfterMs,
      };
    }

    const topic = repo.createTopic({
      categorySlug,
      authorId: author.id,
      title: cleanTitle,
      body: cleanBody,
      isMarketplace: category.isMarketplace ? 1 : 0,
    });
    return { ok: true, topic };
  }

  /**
   * owner edit topic
   * @returns {{ ok, topic?, error?, status? }}
   */
  function updateTopic({ author, topicId, title, body }) {
    if (!author || !author.id) {
      return { ok: false, error: "auth_required", status: 401 };
    }
    if (!isValidContentId(topicId, "ft")) {
      return { ok: false, error: "invalid_topic_id", status: 400 };
    }
    const topic = repo.getTopicById(topicId, { includeHidden: false });
    if (!topic) {
      return { ok: false, error: "topic_not_found", status: 404 };
    }
    if (topic.authorId !== author.id) {
      return { ok: false, error: "not_owner", status: 403 };
    }

    const updates = {};
    if (title !== undefined) {
      const cleanTitle = sanitizeSingleLine(title, LIMITS.titleMaxLength);
      if (!cleanTitle) return { ok: false, error: "title_required", status: 400 };
      updates.title = cleanTitle;
    }
    if (body !== undefined) {
      const cleanBody = sanitizeBody(body, LIMITS.bodyMaxLength);
      if (!cleanBody || cleanBody.length < LIMITS.bodyMinLength) {
        return { ok: false, error: "body_too_short", status: 400 };
      }
      updates.body = cleanBody;
    }
    const updated = repo.updateTopic(topicId, updates);
    return { ok: true, topic: updated };
  }

  /**
   * owner delete topic (soft delete)
   */
  function deleteTopic({ author, topicId }) {
    if (!author || !author.id) {
      return { ok: false, error: "auth_required", status: 401 };
    }
    if (!isValidContentId(topicId, "ft")) {
      return { ok: false, error: "invalid_topic_id", status: 400 };
    }
    const topic = repo.getTopicById(topicId, { includeHidden: false });
    if (!topic) {
      return { ok: false, error: "topic_not_found", status: 404 };
    }
    if (topic.authorId !== author.id) {
      return { ok: false, error: "not_owner", status: 403 };
    }
    repo.deleteTopic(topicId);
    return { ok: true };
  }

  /* ============================================================
     POSTS (replies)
     ============================================================ */

  function listPosts(topicId, opts = {}) {
    if (!isValidContentId(topicId, "ft")) {
      return { items: [], total: 0, limit: 20, offset: 0, hasMore: false };
    }
    return repo.listPosts(topicId, opts);
  }

  function createPost({ author, topicId, body }) {
    if (!author || !author.id) {
      return { ok: false, error: "auth_required", status: 401 };
    }
    if (!isValidContentId(topicId, "ft")) {
      return { ok: false, error: "invalid_topic_id", status: 400 };
    }
    const topic = repo.getTopicById(topicId, { includeHidden: false });
    if (!topic) {
      return { ok: false, error: "topic_not_found", status: 404 };
    }

    const cleanBody = sanitizeBody(body, LIMITS.bodyMaxLength);
    if (!cleanBody || cleanBody.length < LIMITS.bodyMinLength) {
      return { ok: false, error: "body_too_short", status: 400 };
    }

    const rl = rateLimiter.tryConsume(author.id);
    if (!rl.allowed) {
      return {
        ok: false,
        error: "rate_limited",
        status: 429,
        retryAfterMs: rl.retryAfterMs,
      };
    }

    const post = repo.createPost({ topicId, authorId: author.id, body: cleanBody });
    return { ok: true, post };
  }

  function updatePost({ author, postId, body }) {
    if (!author || !author.id) {
      return { ok: false, error: "auth_required", status: 401 };
    }
    if (!isValidContentId(postId, "fp")) {
      return { ok: false, error: "invalid_post_id", status: 400 };
    }
    const post = repo.getPostById(postId);
    if (!post || post.moderation !== "visible" || post.deletedAt) {
      return { ok: false, error: "post_not_found", status: 404 };
    }
    if (post.authorId !== author.id) {
      return { ok: false, error: "not_owner", status: 403 };
    }
    const cleanBody = sanitizeBody(body, LIMITS.bodyMaxLength);
    if (!cleanBody || cleanBody.length < LIMITS.bodyMinLength) {
      return { ok: false, error: "body_too_short", status: 400 };
    }
    const updated = repo.updatePost(postId, { body: cleanBody });
    return { ok: true, post: updated };
  }

  function deletePost({ author, postId }) {
    if (!author || !author.id) {
      return { ok: false, error: "auth_required", status: 401 };
    }
    if (!isValidContentId(postId, "fp")) {
      return { ok: false, error: "invalid_post_id", status: 400 };
    }
    const post = repo.getPostById(postId);
    if (!post || post.deletedAt) {
      return { ok: false, error: "post_not_found", status: 404 };
    }
    if (post.authorId !== author.id) {
      return { ok: false, error: "not_owner", status: 403 };
    }
    repo.deletePost(postId);
    return { ok: true };
  }

  /* ============================================================
     ATTACHMENTS (metadata save — actual bytes handled by API layer via uploadStore)
     ============================================================ */

  /**
   * บันทึก metadata ของไฟล์ที่อัปโหลดแล้ว
   * ใช้หลัง uploadStore.save() สำเร็จ
   */
  function recordAttachment({
    author,
    ownerType,
    ownerId,
    originalName,
    storedName,
    storedPath,
    mimeType,
    byteSize,
  }) {
    if (!author || !author.id) {
      return { ok: false, error: "auth_required", status: 401 };
    }
    if (ownerType !== "topic" && ownerType !== "post") {
      return { ok: false, error: "invalid_owner_type", status: 400 };
    }
    // owner ต้องเป็นของ author นี้
    if (ownerType === "topic") {
      const t = repo.getTopicById(ownerId, { includeHidden: false });
      if (!t || t.authorId !== author.id) {
        return { ok: false, error: "not_owner", status: 403 };
      }
    } else {
      const p = repo.getPostById(ownerId);
      if (!p || p.authorId !== author.id) {
        return { ok: false, error: "not_owner", status: 403 };
      }
    }

    // validate อีกครั้ง (defense-in-depth)
    const v = validateUpload({
      originalName,
      mimeType,
      byteSize,
    });
    if (!v.ok) {
      return { ok: false, error: v.error, status: 400 };
    }
    // ตรวจจำนวนไฟล์ต่อ owner (cap)
    const existing = repo.listAttachmentsByOwner(ownerType, ownerId);
    if (existing.length >= uploadStore.maxFiles) {
      return { ok: false, error: "too_many_attachments", status: 400 };
    }

    const id = repo.addAttachment({
      ownerType,
      ownerId,
      authorId: author.id,
      originalName: sanitizeFileName(originalName),
      storedName,
      storedPath,
      mimeType,
      byteSize,
    });
    return { ok: true, id };
  }

  function listAttachments(ownerType, ownerId) {
    return repo.listAttachmentsByOwner(ownerType, ownerId);
  }

  /* ============================================================
     REPORTS
     ============================================================ */

  /**
   * แจ้ง report topic หรือ post
   * @returns {{ ok, id?, error?, status? }}
   */
  function createReport({ author, targetType, targetId, reason }) {
    if (!author || !author.id) {
      return { ok: false, error: "auth_required", status: 401 };
    }
    if (targetType !== "topic" && targetType !== "post") {
      return { ok: false, error: "invalid_target_type", status: 400 };
    }
    if (targetType === "topic" && !isValidContentId(targetId, "ft")) {
      return { ok: false, error: "invalid_target_id", status: 400 };
    }
    if (targetType === "post" && !isValidContentId(targetId, "fp")) {
      return { ok: false, error: "invalid_target_id", status: 400 };
    }
    // target ต้องมีอยู่จริง
    if (targetType === "topic") {
      const t = repo.getTopicById(targetId, { includeHidden: false });
      if (!t) return { ok: false, error: "target_not_found", status: 404 };
    } else {
      const p = repo.getPostById(targetId);
      if (!p || p.deletedAt) {
        return { ok: false, error: "target_not_found", status: 404 };
      }
    }

    const cleanReason = sanitizeBody(reason, LIMITS.reasonMaxLength);
    if (!cleanReason) {
      return { ok: false, error: "reason_required", status: 400 };
    }

    const rl = rateLimiter.tryConsume(`report:${author.id}`);
    if (!rl.allowed) {
      return {
        ok: false,
        error: "rate_limited",
        status: 429,
        retryAfterMs: rl.retryAfterMs,
      };
    }

    const id = repo.createReport({
      targetType,
      targetId,
      reporterId: author.id,
      reason: cleanReason,
    });
    return { ok: true, id };
  }

  /* ============================================================
     STATS (สำหรับ homepage/landing)
     ============================================================ */
  function getStats() {
    return {
      topics: repo.countTopics(),
      posts: repo.countPosts(),
      openReports: repo.countOpenReports(),
      categories: repo.listCategories().length,
    };
  }

  // expose repo + rateLimiter + uploadStore สำหรับ test/API
  return {
    // identity
    createGuestProfile,
    resolveAuthor,
    // categories
    listCategories,
    getCategory,
    // topics
    listTopics,
    getTopic,
    createTopic,
    updateTopic,
    deleteTopic,
    // posts
    listPosts,
    createPost,
    updatePost,
    deletePost,
    // attachments
    recordAttachment,
    listAttachments,
    // reports
    createReport,
    // stats
    getStats,
    // internal (for API + test)
    _repo: repo,
    _rateLimiter: rateLimiter,
    _uploadStore: uploadStore,
    _limits: LIMITS,
  };
}
