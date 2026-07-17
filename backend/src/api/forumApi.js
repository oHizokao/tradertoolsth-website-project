/* ============================================================
   Forum API — public + author endpoints สำหรับ Community Forum
   ------------------------------------------------------------
   Public endpoints (อ่าน):
     GET /api/forum/categories
     GET /api/forum/categories/:slug
     GET /api/forum/topics?category=&limit=&offset=&sort=&search=
     GET /api/forum/topics/:id
     GET /api/forum/topics/:id/posts?limit=&offset=
     GET /api/forum/stats

   Author endpoints (ต้องมี x-forum-token header):
     POST /api/forum/auth/guest          { displayName } → { author, anonToken }
     POST /api/forum/topics              { categorySlug, title, body } → topic
     POST /api/forum/topics/:id/posts    { body } → post
     PUT  /api/forum/topics/:id          { title?, body? } → topic (owner)
     PUT  /api/forum/posts/:id           { body } → post (owner)
     DELETE /api/forum/topics/:id        (owner)
     DELETE /api/forum/posts/:id         (owner)
     POST /api/forum/reports             { targetType, targetId, reason }
     POST /api/forum/attachments         multipart { ownerType, ownerId, file }

   Static:
     GET /api/forum/attachments/:path    (serve uploaded file, path-traversal safe)

   กฎ QC:
   - x-forum-token (anon) เป็น identity หลัก — ไม่ใช้ IP (กัน NAT/CGNAT false-positive)
   - rate limit + sanitize ทุก input (defense-in-depth)
   - ไม่ expose anonToken ใน response อื่นนอกจาก endpoint สร้าง profile
   - ใช้ CSRF/Origin check เฉพาะ state-changing (POST/PUT/DELETE)
   ============================================================ */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  readMultipartRequest,
  parseMultipartBuffer,
  MultipartError,
} from "../utils/multipart.js";
import { validateUpload } from "../forum/sanitize.js";

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * สร้าง handler สำหรับ forum API
 * @param {object} opts { forumService, json, isOriginAllowed? }
 * @returns {(req, res, url, reqOpts) => boolean} คืน true ถ้าจัดการเรียบร้อย
 */
export function createForumApiHandler(opts) {
  const { forumService, json } = opts;
  const isOriginAllowed = opts.isOriginAllowed || (() => true);

  function reply(res, status, payload) {
    json(res, status, payload);
    return true;
  }

  /** read x-forum-token header (anon identity) */
  function getToken(req) {
    return req.headers["x-forum-token"] || "";
  }

  /** resolve author จาก token — คืน null ถ้าไม่มี/ไม่ valid */
  function auth(req) {
    return forumService.resolveAuthor(getToken(req));
  }

  /** ตรวจ state-changing CSRF (Origin) — return true ถ้าผ่าน */
  function checkOrigin(req, res, reqOpts) {
    const allowed = reqOpts?.adminAllowedOrigins || [];
    if (!isOriginAllowed(req, allowed)) {
      json(res, 403, { error: "origin_not_allowed" });
      return false;
    }
    return true;
  }

  return async function forumApiHandler(req, res, url, reqOpts) {
    const pathname = url.pathname;
    const method = req.method;

    // ====== GET /api/forum/stats ======
    if (method === "GET" && pathname === "/api/forum/stats") {
      return reply(res, 200, forumService.getStats());
    }

    // ====== GET /api/forum/categories ======
    if (method === "GET" && pathname === "/api/forum/categories") {
      return reply(res, 200, { items: forumService.listCategories() });
    }

    // ====== GET /api/forum/categories/:slug ======
    const catMatch = pathname.match(/^\/api\/forum\/categories\/([^/]+)$/);
    if (method === "GET" && catMatch) {
      const slug = decodeURIComponent(catMatch[1]);
      const cat = forumService.getCategory(slug);
      if (!cat) return reply(res, 404, { error: "category_not_found" });
      return reply(res, 200, cat);
    }

    // ====== GET /api/forum/topics ======
    if (method === "GET" && pathname === "/api/forum/topics") {
      const categorySlug = url.searchParams.get("category") || "";
      const limit = clampInt(url.searchParams.get("limit"), 20, 1, 100);
      const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);
      const sort = url.searchParams.get("sort") || "recent";
      const search = url.searchParams.get("search") || "";
      const result = forumService.listTopics({
        categorySlug,
        limit,
        offset,
        sort,
        search,
      });
      return reply(res, 200, result);
    }

    // ====== POST /api/forum/auth/guest (สร้าง guest profile) ======
    if (method === "POST" && pathname === "/api/forum/auth/guest") {
      if (!checkOrigin(req, res, reqOpts)) return true;
      const body = await readJson(req).catch(() => ({}));
      const result = forumService.createGuestProfile(body.displayName);
      if (!result.ok) {
        return reply(res, result.status || 400, { error: result.error });
      }
      return reply(res, 201, {
        author: result.author,
        anonToken: result.anonToken,
      });
    }

    // ====== POST /api/forum/topics (create topic) ======
    if (method === "POST" && pathname === "/api/forum/topics") {
      if (!checkOrigin(req, res, reqOpts)) return true;
      const author = auth(req);
      const body = await readJson(req).catch(() => ({}));
      const result = forumService.createTopic({
        author,
        categorySlug: body.categorySlug,
        title: body.title,
        body: body.body,
      });
      if (!result.ok) {
        if (result.retryAfterMs) {
          res.setHeader("retry-after", String(Math.ceil(result.retryAfterMs / 1000)));
        }
        return reply(res, result.status || 400, { error: result.error });
      }
      return reply(res, 201, toPublicTopic(result.topic));
    }

    // ====== GET /api/forum/topics/:id ======
    const topicMatch = pathname.match(/^\/api\/forum\/topics\/([^/]+)$/);
    if (method === "GET" && topicMatch) {
      const id = decodeURIComponent(topicMatch[1]);
      const topic = forumService.getTopic(id, { incrementViews: true });
      if (!topic) return reply(res, 404, { error: "topic_not_found" });
      return reply(res, 200, toPublicTopicDetail(topic));
    }

    // ====== PUT /api/forum/topics/:id (owner edit) ======
    if (method === "PUT" && topicMatch) {
      if (!checkOrigin(req, res, reqOpts)) return true;
      const id = decodeURIComponent(topicMatch[1]);
      const author = auth(req);
      const body = await readJson(req).catch(() => ({}));
      const result = forumService.updateTopic({
        author,
        topicId: id,
        title: body.title,
        body: body.body,
      });
      if (!result.ok) return reply(res, result.status || 400, { error: result.error });
      return reply(res, 200, toPublicTopic(result.topic));
    }

    // ====== DELETE /api/forum/topics/:id (owner delete) ======
    if (method === "DELETE" && topicMatch) {
      if (!checkOrigin(req, res, reqOpts)) return true;
      const id = decodeURIComponent(topicMatch[1]);
      const author = auth(req);
      const result = forumService.deleteTopic({ author, topicId: id });
      if (!result.ok) return reply(res, result.status || 400, { error: result.error });
      return reply(res, 200, { ok: true, id });
    }

    // ====== GET /api/forum/topics/:id/posts ======
    const postsMatch = pathname.match(
      /^\/api\/forum\/topics\/([^/]+)\/posts$/
    );
    if (method === "GET" && postsMatch) {
      const topicId = decodeURIComponent(postsMatch[1]);
      const limit = clampInt(url.searchParams.get("limit"), 20, 1, 100);
      const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);
      const result = forumService.listPosts(topicId, { limit, offset });
      return reply(res, 200, {
        ...result,
        items: result.items.map(toPublicPost),
      });
    }

    // ====== POST /api/forum/topics/:id/posts (reply) ======
    if (method === "POST" && postsMatch) {
      if (!checkOrigin(req, res, reqOpts)) return true;
      const topicId = decodeURIComponent(postsMatch[1]);
      const author = auth(req);
      const body = await readJson(req).catch(() => ({}));
      const result = forumService.createPost({
        author,
        topicId,
        body: body.body,
      });
      if (!result.ok) {
        if (result.retryAfterMs) {
          res.setHeader("retry-after", String(Math.ceil(result.retryAfterMs / 1000)));
        }
        return reply(res, result.status || 400, { error: result.error });
      }
      return reply(res, 201, toPublicPost(result.post));
    }

    // ====== PUT/DELETE /api/forum/posts/:id ======
    const postMatch = pathname.match(/^\/api\/forum\/posts\/([^/]+)$/);
    if (method === "PUT" && postMatch) {
      if (!checkOrigin(req, res, reqOpts)) return true;
      const id = decodeURIComponent(postMatch[1]);
      const author = auth(req);
      const body = await readJson(req).catch(() => ({}));
      const result = forumService.updatePost({
        author,
        postId: id,
        body: body.body,
      });
      if (!result.ok) return reply(res, result.status || 400, { error: result.error });
      return reply(res, 200, toPublicPost(result.post));
    }
    if (method === "DELETE" && postMatch) {
      if (!checkOrigin(req, res, reqOpts)) return true;
      const id = decodeURIComponent(postMatch[1]);
      const author = auth(req);
      const result = forumService.deletePost({ author, postId: id });
      if (!result.ok) return reply(res, result.status || 400, { error: result.error });
      return reply(res, 200, { ok: true, id });
    }

    // ====== POST /api/forum/reports ======
    if (method === "POST" && pathname === "/api/forum/reports") {
      if (!checkOrigin(req, res, reqOpts)) return true;
      const author = auth(req);
      const body = await readJson(req).catch(() => ({}));
      const result = forumService.createReport({
        author,
        targetType: body.targetType,
        targetId: body.targetId,
        reason: body.reason,
      });
      if (!result.ok) {
        if (result.retryAfterMs) {
          res.setHeader("retry-after", String(Math.ceil(result.retryAfterMs / 1000)));
        }
        return reply(res, result.status || 400, { error: result.error });
      }
      return reply(res, 201, { ok: true, id: result.id });
    }

    // ====== POST /api/forum/attachments (owner upload) ======
    if (method === "POST" && pathname === "/api/forum/attachments") {
      if (!checkOrigin(req, res, reqOpts)) return true;
      const author = auth(req);
      if (!author) return reply(res, 401, { error: "auth_required" });

      const store = forumService._uploadStore;
      let parsed;
      try {
        const { buffer, boundary } = await readMultipartRequest(
          req,
          store.maxBytes + 64 * 1024
        );
        parsed = parseMultipartBuffer(buffer, boundary);
      } catch (err) {
        if (err instanceof MultipartError) {
          return reply(res, err.code === "file_too_large" ? 413 : 400, {
            error: err.code,
          });
        }
        return reply(res, 400, { error: "upload_parse_failed" });
      }

      const file = parsed.files.get("file");
      if (!file) return reply(res, 400, { error: "file_required" });
      const validated = validateUpload({
        originalName: file.filename,
        mimeType: file.contentType,
        byteSize: file.size,
        buffer: file.buffer,
      });
      if (!validated.ok) return reply(res, 400, { error: validated.error });

      let saved;
      try {
        saved = await store.save({
          buffer: file.buffer,
          ext: validated.ext,
          mime: validated.mime,
        });
        const result = forumService.recordAttachment({
          author,
          ownerType: parsed.fields.ownerType,
          ownerId: parsed.fields.ownerId,
          originalName: validated.safeName,
          storedName: saved.storedName,
          storedPath: saved.storedPath,
          mimeType: validated.mime,
          byteSize: saved.byteSize,
        });
        if (!result.ok) {
          await store.removeStored(saved.storedPath).catch(() => {});
          return reply(res, result.status || 400, { error: result.error });
        }
        const attachment = forumService
          .listAttachments(parsed.fields.ownerType, parsed.fields.ownerId)
          .find((item) => item.id === result.id);
        return reply(res, 201, toPublicAttachment(attachment));
      } catch (err) {
        if (saved?.storedPath) {
          await store.removeStored(saved.storedPath).catch(() => {});
        }
        const code = err?.code || err?.message || "upload_failed";
        return reply(res, code === "file_too_large" ? 413 : 400, { error: code });
      }
    }

    // ====== GET /api/forum/attachments/:path (static serve, path-traversal safe) ======
    const attachMatch = pathname.match(/^\/api\/forum\/attachments\/(.+)$/);
    if (method === "GET" && attachMatch) {
      const relPath = decodeURIComponent(attachMatch[1]);
      return serveAttachment(res, relPath, forumService);
    }

    return false; // ไม่ใช่ forum endpoint → caller route ต่อ
  };

  /* ---------- helpers ---------- */

  async function readJson(req, maxBytes = 64 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) throw new Error("request_too_large");
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  async function serveAttachment(res, relPath, service) {
    const store = service._uploadStore;
    const info = await store.statSafe(relPath);
    if (!info) return reply(res, 404, { error: "attachment_not_found" });
    const ext = extname(relPath).toLowerCase();
    const mime = MIME[ext];
    if (!mime) return reply(res, 403, { error: "type_not_allowed" });
    try {
      const data = await readFile(info.abs);
      res.writeHead(200, {
        "content-type": mime,
        "content-length": data.length,
        "cache-control": "public, max-age=86400, immutable",
        "x-content-type-options": "nosniff",
      });
      res.end(data);
      return true;
    } catch {
      return reply(res, 404, { error: "attachment_not_found" });
    }
  }
}

/* ============================================================
   PUBLIC MAPPER — ตัด internal fields
   ============================================================ */

function toPublicTopic(t) {
  if (!t) return null;
  return {
    id: t.id,
    categorySlug: t.categorySlug,
    authorId: t.authorId,
    title: t.title,
    body: t.body,
    isMarketplace: !!t.isMarketplace,
    moderation: t.moderation,
    pinned: !!t.pinned,
    viewCount: t.viewCount,
    replyCount: t.replyCount,
    lastActivityAt: t.lastActivityAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    authorName: t.authorName || null,
    authorKind: t.authorKind || null,
  };
}

function toPublicTopicDetail(t) {
  const base = toPublicTopic(t);
  return {
    ...base,
    author: t.author
      ? {
          id: t.author.id,
          displayName: t.author.displayName,
          kind: t.author.kind,
        }
      : null,
    category: t.category
      ? {
          slug: t.category.slug,
          name: t.category.name,
          isMarketplace: t.category.isMarketplace,
        }
      : null,
    attachments: (t.attachments || []).map(toPublicAttachment),
  };
}

function toPublicPost(p) {
  if (!p) return null;
  return {
    id: p.id,
    topicId: p.topicId,
    authorId: p.authorId,
    body: p.body,
    moderation: p.moderation,
    floor: p.floor,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    authorName: p.authorName || null,
    authorKind: p.authorKind || null,
  };
}

function toPublicAttachment(a) {
  if (!a) return null;
  return {
    id: a.id,
    ownerType: a.ownerType,
    ownerId: a.ownerId,
    originalName: a.originalName,
    mimeType: a.mimeType,
    byteSize: a.byteSize,
    url: `/api/forum/attachments/${a.storedPath}`,
    createdAt: a.createdAt,
  };
}
