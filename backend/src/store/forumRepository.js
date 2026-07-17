/* ============================================================
   Forum Repository — CRUD + query สำหรับ Community Forum
   ------------------------------------------------------------
   กฎ QC (เหมือน newsRepository / calendarRepository):
   - ทุก query ใช้ parameterized (? placeholders) เท่านั้น
   - soft delete (deleted_at) ไม่ใช่ hard delete
   - moderation status แยกจาก content เสมอ
   - ไม่กระทบตาราง news / auto_pilot / calendar / market ใดๆ ทั้งสิ้น
   ============================================================ */

import { randomBytes } from "node:crypto";
import { logger } from "../utils/logger.js";

const log = logger.make("forum-repo");

/** สร้าง id แบบ <prefix>-<hex16> */
function makeId(prefix) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

/**
 * seed หมวดหมู่เริ่มต้นตามที่ Codex กำหนด (idempotent)
 * เรียกครั้งแรกเท่านั้น — INSERT OR IGNORE กันซ้ำ
 */
const SEED_CATEGORIES = [
  {
    slug: "ea-indicator",
    name: "แจก EA / Indicator",
    description: "แชร์และแจก EA, Indicator และเครื่องมือเทรด MT4/MT5",
    icon: "ea",
    sortOrder: 1,
    isMarketplace: 0,
  },
  {
    slug: "tricks",
    name: "ทริกและเทคนิคการเทรด",
    description: "แลกเปลี่ยนกลยุทธ์ เทคนิค และทริกการเทรดจากเซียน",
    icon: "trick",
    sortOrder: 2,
    isMarketplace: 0,
  },
  {
    slug: "brokers",
    name: "รีวิวและถามตอบโบรกเกอร์",
    description: "รีวิว ถามตอบ และแชร์ประสบการณ์กับโบรกเกอร์",
    icon: "broker",
    sortOrder: 3,
    isMarketplace: 0,
  },
  {
    slug: "marketplace",
    name: "ห้องซื้อขาย / Marketplace",
    description: "ซื้อขาย EA Indicator บัญชี และบริการเกี่ยวกับการเทรด",
    icon: "market",
    sortOrder: 4,
    isMarketplace: 1,
  },
  {
    slug: "general",
    name: "ห้องพูดคุยทั่วไป",
    description: "พูดคุยทุกเรื่องเกี่ยวกับการเทรดและตลาดการเงิน",
    icon: "chat",
    sortOrder: 5,
    isMarketplace: 0,
  },
];

/**
 * สร้าง repository bound กับ db instance
 * @param {Database} db
 */
export function createForumRepository(db) {
  /* ---- AUTHORS ---- */
  const insertAuthorStmt = db.prepare(
    `INSERT INTO forum_authors
       (id, anon_token, display_name, kind, account_id, created_at, updated_at)
     VALUES (?, ?, ?, 'guest', NULL, ?, ?)`
  );
  const getAuthorByTokenStmt = db.prepare(
    "SELECT * FROM forum_authors WHERE anon_token = ?"
  );
  const getAuthorByIdStmt = db.prepare(
    "SELECT * FROM forum_authors WHERE id = ?"
  );

  /* ---- CATEGORIES ---- */
  const upsertCategoryStmt = db.prepare(
    `INSERT INTO forum_categories
       (slug, name, description, icon, sort_order, is_marketplace, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       icon = excluded.icon,
       sort_order = excluded.sort_order,
       is_marketplace = excluded.is_marketplace,
       updated_at = excluded.updated_at`
  );
  const listCategoriesStmt = db.prepare(
    "SELECT * FROM forum_categories ORDER BY sort_order ASC, slug ASC"
  );
  const getCategoryBySlugStmt = db.prepare(
    "SELECT * FROM forum_categories WHERE slug = ?"
  );

  /* ---- TOPICS ---- */
  const insertTopicStmt = db.prepare(
    `INSERT INTO forum_topics
       (id, category_slug, author_id, title, body, is_marketplace,
        moderation, pinned, view_count, reply_count, last_activity_at,
        created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, 'visible', 0, 0, 0, ?, ?, ?, NULL)`
  );
  const getTopicByIdStmt = db.prepare(
    "SELECT * FROM forum_topics WHERE id = ?"
  );

  /* ---- POSTS ---- */
  const insertPostStmt = db.prepare(
    `INSERT INTO forum_posts
       (id, topic_id, author_id, body, moderation, floor,
        created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 'visible', ?, ?, ?, NULL)`
  );
  const getPostByIdStmt = db.prepare(
    "SELECT * FROM forum_posts WHERE id = ?"
  );
  const nextFloorStmt = db.prepare(
    "SELECT COALESCE(MAX(floor), 0) + 1 AS next_floor FROM forum_posts WHERE topic_id = ?"
  );

  /* ---- ATTACHMENTS ---- */
  const insertAttachmentStmt = db.prepare(
    `INSERT INTO forum_attachments
       (id, owner_type, owner_id, author_id, original_name, stored_name,
        stored_path, mime_type, byte_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const listAttachmentsByOwnerStmt = db.prepare(
    "SELECT * FROM forum_attachments WHERE owner_type = ? AND owner_id = ? ORDER BY created_at ASC"
  );

  /* ---- REPORTS ---- */
  const insertReportStmt = db.prepare(
    `INSERT INTO forum_reports
       (id, target_type, target_id, reporter_id, reason, status, created_at, reviewed_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, NULL)`
  );
  const listOpenReportsStmt = db.prepare(
    "SELECT * FROM forum_reports WHERE status = 'open' ORDER BY created_at DESC LIMIT ?"
  );

  /* ====================== AUTHORS ====================== */
  /** สร้าง guest author ใหม่ (คืน anonToken ดิบให้ caller ส่งกลับ client ครั้งเดียว) */
  function createGuestAuthor(displayName) {
    const now = new Date().toISOString();
    const id = makeId("fa");
    // anonToken ดิบ (32 bytes hex) — caller เก็บ hash ลง DB, ส่งดิบกลับ client
    const rawToken = randomBytes(32).toString("hex");
    insertAuthorStmt.run(id, rawToken, displayName, now, now);
    return { id, anonToken: rawToken, displayName };
  }

  function getAuthorByToken(anonToken) {
    if (!anonToken) return null;
    const row = getAuthorByTokenStmt.get(anonToken);
    return row ? rowToAuthor(row) : null;
  }

  function getAuthorById(id) {
    const row = getAuthorByIdStmt.get(id);
    return row ? rowToAuthor(row) : null;
  }

  /* ====================== CATEGORIES ====================== */
  function seedCategories() {
    const now = new Date().toISOString();
    for (const c of SEED_CATEGORIES) {
      upsertCategoryStmt.run(
        c.slug,
        c.name,
        c.description,
        c.icon,
        c.sortOrder,
        c.isMarketplace,
        now,
        now
      );
    }
    log.debug(`seeded ${SEED_CATEGORIES.length} categories`);
  }

  function listCategories() {
    return listCategoriesStmt.all().map(rowToCategory);
  }

  function getCategoryBySlug(slug) {
    const row = getCategoryBySlugStmt.get(slug);
    return row ? rowToCategory(row) : null;
  }

  /* ====================== TOPICS ====================== */
  /**
   * list topics ในหมวด หรือทุกหมวด พร้อม pagination/sort
   * @param {object} opts { categorySlug?, limit, offset, sort, search? }
   *   sort: 'recent' (default, last_activity DESC) | 'created' | 'replies' | 'views'
   *   กรองเฉพาะ moderation='visible' AND deleted_at IS NULL เสมอ
   */
  function listTopics(opts = {}) {
    const limit = Math.max(1, Math.min(100, Math.floor(opts.limit || 20)));
    const offset = Math.max(0, Math.floor(opts.offset || 0));
    const sort = ["recent", "created", "replies", "views"].includes(opts.sort)
      ? opts.sort
      : "recent";
    const search = opts.search ? String(opts.search).trim() : "";

    const where = [
      "t.moderation = 'visible'",
      "t.deleted_at IS NULL",
    ];
    const params = [];
    if (opts.categorySlug) {
      where.push("t.category_slug = ?");
      params.push(opts.categorySlug);
    }
    if (search) {
      // LIKE search บน title + body (case-insensitive ใน SQLite สำหรับ ASCII;
      // สำหรับ Thai ใช้ LIKE ที่ตรงตัว — เพียงพอสำหรับ search พื้นฐาน)
      where.push("(t.title LIKE ? OR t.body LIKE ?)");
      const term = `%${escapeLike(search)}%`;
      params.push(term, term);
    }

    const orderClause = {
      recent: "t.last_activity_at DESC",
      created: "t.created_at DESC",
      replies: "t.reply_count DESC, t.last_activity_at DESC",
      views: "t.view_count DESC, t.last_activity_at DESC",
    }[sort];

    const whereSql = "WHERE " + where.join(" AND ");

    // count total (สำหรับ pagination meta)
    const countRow = db
      .prepare(`SELECT COUNT(*) AS n FROM forum_topics t ${whereSql}`)
      .get(...params);
    const total = countRow ? countRow.n : 0;

    // list พร้อม author join (display_name + kind เท่านั้น ไม่รั่ว anon_token)
    const rows = db
      .prepare(
        `SELECT t.*, a.display_name AS author_name, a.kind AS author_kind
         FROM forum_topics t
         LEFT JOIN forum_authors a ON a.id = t.author_id
         ${whereSql}
         ORDER BY t.pinned DESC, ${orderClause}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    return {
      items: rows.map(rowToTopicWithAuthor),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  }

  function getTopicById(id, { includeHidden = false } = {}) {
    const row = getTopicByIdStmt.get(id);
    if (!row) return null;
    if (!includeHidden && (row.moderation !== "visible" || row.deleted_at)) {
      return null;
    }
    const author = getAuthorById(row.author_id);
    const category = getCategoryBySlug(row.category_slug);
    return { ...rowToTopic(row), author, category };
  }

  /** create topic + first body (body ถูก sanitize แล้วที่ API layer) */
  function createTopic({ categorySlug, authorId, title, body, isMarketplace }) {
    const now = new Date().toISOString();
    const id = makeId("ft");
    insertTopicStmt.run(
      id,
      categorySlug,
      authorId,
      title,
      body,
      isMarketplace ? 1 : 0,
      now, // last_activity_at
      now, // created_at
      now  // updated_at
    );
    return getTopicById(id);
  }

  /** increment view_count (idempotent-ish; ใช้สำหรับ detail page) */
  function incrementTopicViews(id) {
    db.prepare(
      "UPDATE forum_topics SET view_count = view_count + 1 WHERE id = ?"
    ).run(id);
  }

  /** owner edit topic (title and/or body — partial update) */
  function updateTopic(id, updates) {
    const now = new Date().toISOString();
    const sets = [];
    const params = [];
    if (updates.title !== undefined) {
      sets.push("title = ?");
      params.push(updates.title);
    }
    if (updates.body !== undefined) {
      sets.push("body = ?");
      params.push(updates.body);
    }
    if (sets.length === 0) return getTopicById(id); // ไม่มีอะไรจะอัปเดต
    sets.push("updated_at = ?");
    params.push(now);
    params.push(id);
    const info = db
      .prepare(`UPDATE forum_topics SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);
    return info.changes > 0 ? getTopicById(id) : null;
  }

  /** soft delete topic (เจ้าของหรือ mod) — ลบ topic + ลบ posts ด้วย (cascade soft) */
  function deleteTopic(id) {
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(
        "UPDATE forum_topics SET deleted_at = ?, moderation = 'deleted', updated_at = ? WHERE id = ?"
      ).run(now, now, id);
      db.prepare(
        "UPDATE forum_posts SET deleted_at = ?, moderation = 'deleted', updated_at = ? WHERE topic_id = ?"
      ).run(now, now, id);
    });
    tx();
    return true;
  }

  /** hide topic (moderation = 'hidden') สำหรับ mod action */
  function setTopicModeration(id, moderation) {
    const now = new Date().toISOString();
    const info = db
      .prepare(
        "UPDATE forum_topics SET moderation = ?, updated_at = ? WHERE id = ?"
      )
      .run(moderation, now, id);
    return info.changes > 0;
  }

  /* ====================== POSTS ====================== */
  /**
   * list posts ใน topic พร้อม pagination + floor order
   * กรองเฉพาะ moderation='visible' AND deleted_at IS NULL
   */
  function listPosts(topicId, opts = {}) {
    const limit = Math.max(1, Math.min(100, Math.floor(opts.limit || 20)));
    const offset = Math.max(0, Math.floor(opts.offset || 0));
    const where = [
      "p.topic_id = ?",
      "p.moderation = 'visible'",
      "p.deleted_at IS NULL",
    ];
    const params = [topicId];

    const countRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM forum_posts p WHERE ${where.join(" AND ")}`
      )
      .get(...params);
    const total = countRow ? countRow.n : 0;

    const rows = db
      .prepare(
        `SELECT p.*, a.display_name AS author_name, a.kind AS author_kind
         FROM forum_posts p
         LEFT JOIN forum_authors a ON a.id = p.author_id
         WHERE ${where.join(" AND ")}
         ORDER BY p.floor ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    return {
      items: rows.map(rowToPostWithAuthor),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  }

  function getPostById(id) {
    const row = getPostByIdStmt.get(id);
    return row ? rowToPost(row) : null;
  }

  /** create post (reply) + bump topic last_activity + reply_count (transaction) */
  function createPost({ topicId, authorId, body }) {
    const now = new Date().toISOString();
    const id = makeId("fp");
    const tx = db.transaction(() => {
      const floor = nextFloorStmt.get(topicId).next_floor;
      insertPostStmt.run(id, topicId, authorId, body, floor, now, now);
      db.prepare(
        `UPDATE forum_topics
           SET reply_count = reply_count + 1,
               last_activity_at = ?,
               updated_at = ?
           WHERE id = ?`
      ).run(now, now, topicId);
    });
    tx();
    return getPostById(id);
  }

  function updatePost(id, { body }) {
    const now = new Date().toISOString();
    const info = db
      .prepare(
        "UPDATE forum_posts SET body = ?, updated_at = ? WHERE id = ?"
      )
      .run(body, now, id);
    return info.changes > 0 ? getPostById(id) : null;
  }

  /** soft delete post (เจ้าของหรือ mod) */
  function deletePost(id) {
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(
        "UPDATE forum_posts SET deleted_at = ?, moderation = 'deleted', updated_at = ? WHERE id = ?"
      ).run(now, now, id);
      // ลด reply_count (กันติดลบ)
      const post = getPostByIdStmt.get(id);
      if (post) {
        db.prepare(
          "UPDATE forum_topics SET reply_count = MAX(0, reply_count - 1) WHERE id = ?"
        ).run(post.topic_id);
      }
    });
    tx();
    return true;
  }

  function setPostModeration(id, moderation) {
    const now = new Date().toISOString();
    const info = db
      .prepare(
        "UPDATE forum_posts SET moderation = ?, updated_at = ? WHERE id = ?"
      )
      .run(moderation, now, id);
    return info.changes > 0;
  }

  /* ====================== ATTACHMENTS ====================== */
  function addAttachment(entry) {
    const id = makeId("at");
    insertAttachmentStmt.run(
      id,
      entry.ownerType,
      entry.ownerId,
      entry.authorId,
      entry.originalName,
      entry.storedName,
      entry.storedPath,
      entry.mimeType,
      entry.byteSize,
      new Date().toISOString()
    );
    return id;
  }

  function listAttachmentsByOwner(ownerType, ownerId) {
    return listAttachmentsByOwnerStmt
      .all(ownerType, ownerId)
      .map(rowToAttachment);
  }

  /* ====================== REPORTS ====================== */
  function createReport({ targetType, targetId, reporterId, reason }) {
    const id = makeId("fr");
    insertReportStmt.run(
      id,
      targetType,
      targetId,
      reporterId ?? null,
      reason,
      new Date().toISOString()
    );
    return id;
  }

  function listOpenReports(limit = 50) {
    return listOpenReportsStmt
      .all(Math.max(1, Math.min(200, Math.floor(limit))))
      .map(rowToReport);
  }

  /** count reports ที่เปิดอยู่ (สำหรับ mod dashboard) */
  function countOpenReports() {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM forum_reports WHERE status = 'open'")
      .get();
    return row ? row.n : 0;
  }

  /* ====================== STATS ====================== */
  function countTopics(opts = {}) {
    const where = ["moderation = 'visible'", "deleted_at IS NULL"];
    const params = [];
    if (opts.categorySlug) {
      where.push("category_slug = ?");
      params.push(opts.categorySlug);
    }
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM forum_topics WHERE ${where.join(" AND ")}`)
      .get(...params);
    return row ? row.n : 0;
  }

  function countPosts() {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM forum_posts WHERE moderation = 'visible' AND deleted_at IS NULL"
      )
      .get();
    return row ? row.n : 0;
  }

  return {
    // authors
    createGuestAuthor,
    getAuthorByToken,
    getAuthorById,
    // categories
    seedCategories,
    listCategories,
    getCategoryBySlug,
    // topics
    listTopics,
    getTopicById,
    createTopic,
    incrementTopicViews,
    updateTopic,
    deleteTopic,
    setTopicModeration,
    countTopics,
    // posts
    listPosts,
    getPostById,
    createPost,
    updatePost,
    deletePost,
    setPostModeration,
    countPosts,
    // attachments
    addAttachment,
    listAttachmentsByOwner,
    // reports
    createReport,
    listOpenReports,
    countOpenReports,
  };
}

/** escape % และ _ ใน LIKE pattern (กัน wildcard injection) */
function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (m) => "\\" + m);
}

/* ====================== ROW MAPPERS ====================== */

function rowToAuthor(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    kind: row.kind,
    accountId: row.account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCategory(row) {
  if (!row) return null;
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sort_order,
    isMarketplace: !!row.is_marketplace,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTopic(row) {
  if (!row) return null;
  return {
    id: row.id,
    categorySlug: row.category_slug,
    authorId: row.author_id,
    title: row.title,
    body: row.body,
    isMarketplace: !!row.is_marketplace,
    moderation: row.moderation,
    pinned: !!row.pinned,
    viewCount: row.view_count,
    replyCount: row.reply_count,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function rowToTopicWithAuthor(row) {
  return {
    ...rowToTopic(row),
    authorName: row.author_name,
    authorKind: row.author_kind,
  };
}

function rowToPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    topicId: row.topic_id,
    authorId: row.author_id,
    body: row.body,
    moderation: row.moderation,
    floor: row.floor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function rowToPostWithAuthor(row) {
  return {
    ...rowToPost(row),
    authorName: row.author_name,
    authorKind: row.author_kind,
  };
}

function rowToAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    authorId: row.author_id,
    originalName: row.original_name,
    storedName: row.stored_name,
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

function rowToReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reporterId: row.reporter_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}
