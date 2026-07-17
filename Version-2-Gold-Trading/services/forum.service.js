/* ============================================================
   Service Layer — Community Forum Service (V2)
   ------------------------------------------------------------
   - เรียก /api/forum/* (เว็บเราเอง)
   - จัดการ guest identity (anon token) ใน localStorage อย่างปลอดภัย
   - validate response, timeout, error handling
   - ไม่เก็บ password; เก็บเฉพาะ anonToken + displayName
   - ทุกการแสดงผลใช้ textContent (XSS defense — backend sanitize เป็น layer ที่ 2)

   API contract ที่ frontend รอ:
     GET  /api/forum/categories              → { items: Category[] }
     GET  /api/forum/topics?category=&...    → { items, total, limit, offset, hasMore }
     GET  /api/forum/topics/:id              → Topic (detail)
     GET  /api/forum/topics/:id/posts?...    → { items: Post[], ... }
     POST /api/forum/auth/guest              → { author, anonToken }
     POST /api/forum/topics                  → Topic
     POST /api/forum/topics/:id/posts        → Post
     PUT   /api/forum/topics/:id             → Topic (owner)
     PUT   /api/forum/posts/:id              → Post (owner)
     DELETE /api/forum/topics/:id            → { ok }
     DELETE /api/forum/posts/:id             → { ok }
     POST /api/forum/reports                 → { ok, id }
     POST /api/forum/attachments             → Attachment
     GET  /api/forum/stats                   → { topics, posts, ... }
   ============================================================ */

window.TT = window.TT || {};

TT.ForumService = (function () {
  const BASE = "/api/forum";
  const TOKEN_KEY = "tt_forum_token";
  const PROFILE_KEY = "tt_forum_profile";
  const REQUEST_TIMEOUT_MS = 8000;

  // ---------- helpers ----------
  function nowMs() {
    return Date.now();
  }

  async function fetchWithTimeout(url, opts = {}, ms = REQUEST_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /** headers สำหรับ state-changing request (CSRF: Origin + identity) */
  function headers(json = true) {
    const h = {};
    if (json) h["content-type"] = "application/json";
    const token = getStoredToken();
    if (token) h["x-forum-token"] = token;
    return h;
  }

  async function parseJson(res) {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function toError(res, body) {
    if (body && body.error) return body.error;
    if (res.status === 401) return "auth_required";
    if (res.status === 403) return "permission_denied";
    if (res.status === 404) return "not_found";
    if (res.status === 429) return "rate_limited";
    return "http_" + res.status;
  }

  // ---------- identity (localStorage) ----------
  function getStoredToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function getStoredProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setIdentity(anonToken, profile) {
    try {
      if (anonToken) localStorage.setItem(TOKEN_KEY, anonToken);
      if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      /* localStorage อาจถูกบล็อก — ยอมรับได้ */
    }
  }

  function clearIdentity() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PROFILE_KEY);
    } catch {}
  }

  /** current author profile (or null) */
  function currentAuthor() {
    return getStoredProfile();
  }

  /** สร้าง guest profile + เก็บ identity */
  async function createGuestProfile(displayName) {
    const res = await fetchWithTimeout(`${BASE}/auth/guest`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ displayName }),
    });
    const body = await parseJson(res);
    if (!res.ok) {
      const err = new Error(toError(res, body));
      err.code = toError(res, body);
      err.status = res.status;
      throw err;
    }
    setIdentity(body.anonToken, body.author);
    return body;
  }

  // ---------- categories ----------
  async function listCategories() {
    const res = await fetchWithTimeout(`${BASE}/categories`, { headers: {} });
    const body = await parseJson(res);
    if (!res.ok) throw new Error(toError(res, body));
    return body.items || [];
  }

  async function getCategory(slug) {
    const res = await fetchWithTimeout(`${BASE}/categories/${encodeURIComponent(slug)}`, { headers: {} });
    const body = await parseJson(res);
    if (!res.ok) throw new Error(toError(res, body));
    return body;
  }

  // ---------- topics ----------
  async function listTopics({ category, limit, offset, sort, search } = {}) {
    const p = new URLSearchParams();
    if (category) p.set("category", category);
    if (limit) p.set("limit", String(limit));
    if (offset) p.set("offset", String(offset));
    if (sort) p.set("sort", sort);
    if (search) p.set("search", search);
    const qs = p.toString();
    const res = await fetchWithTimeout(`${BASE}/topics${qs ? "?" + qs : ""}`, { headers: {} });
    const body = await parseJson(res);
    if (!res.ok) throw new Error(toError(res, body));
    return body || { items: [], total: 0, limit: 20, offset: 0, hasMore: false };
  }

  async function getTopic(id) {
    const res = await fetchWithTimeout(`${BASE}/topics/${encodeURIComponent(id)}`, { headers: {} });
    const body = await parseJson(res);
    if (!res.ok) throw new Error(toError(res, body));
    return body;
  }

  async function createTopic({ categorySlug, title, body }) {
    const res = await fetchWithTimeout(`${BASE}/topics`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ categorySlug, title, body }),
    });
    const b = await parseJson(res);
    if (!res.ok) {
      const err = new Error(toError(res, b));
      err.code = toError(res, b);
      err.status = res.status;
      if (res.headers.get("retry-after")) err.retryAfter = Number(res.headers.get("retry-after"));
      throw err;
    }
    return b;
  }

  async function updateTopic(id, { title, body }) {
    const res = await fetchWithTimeout(`${BASE}/topics/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ title, body }),
    });
    const b = await parseJson(res);
    if (!res.ok) throw new Error(toError(res, b));
    return b;
  }

  async function deleteTopic(id) {
    const res = await fetchWithTimeout(`${BASE}/topics/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: headers(),
    });
    const b = await parseJson(res);
    if (!res.ok) throw new Error(toError(res, b));
    return b;
  }

  // ---------- posts ----------
  async function listPosts(topicId, { limit, offset } = {}) {
    const p = new URLSearchParams();
    if (limit) p.set("limit", String(limit));
    if (offset) p.set("offset", String(offset));
    const qs = p.toString();
    const res = await fetchWithTimeout(
      `${BASE}/topics/${encodeURIComponent(topicId)}/posts${qs ? "?" + qs : ""}`,
      { headers: {} }
    );
    const body = await parseJson(res);
    if (!res.ok) throw new Error(toError(res, body));
    return body || { items: [], total: 0, limit: 20, offset: 0, hasMore: false };
  }

  async function createPost(topicId, body) {
    const res = await fetchWithTimeout(
      `${BASE}/topics/${encodeURIComponent(topicId)}/posts`,
      { method: "POST", headers: headers(), body: JSON.stringify({ body }) }
    );
    const b = await parseJson(res);
    if (!res.ok) {
      const err = new Error(toError(res, b));
      err.code = toError(res, b);
      err.status = res.status;
      if (res.headers.get("retry-after")) err.retryAfter = Number(res.headers.get("retry-after"));
      throw err;
    }
    return b;
  }

  async function updatePost(id, body) {
    const res = await fetchWithTimeout(`${BASE}/posts/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ body }),
    });
    const b = await parseJson(res);
    if (!res.ok) throw new Error(toError(res, b));
    return b;
  }

  async function deletePost(id) {
    const res = await fetchWithTimeout(`${BASE}/posts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: headers(),
    });
    const b = await parseJson(res);
    if (!res.ok) throw new Error(toError(res, b));
    return b;
  }

  // ---------- attachments ----------
  async function uploadAttachment({ ownerType, ownerId, file }) {
    if (!file) throw new Error("file_required");
    const form = new FormData();
    form.append("ownerType", ownerType);
    form.append("ownerId", ownerId);
    form.append("file", file, file.name);
    const res = await fetchWithTimeout(
      `${BASE}/attachments`,
      { method: "POST", headers: headers(false), body: form },
      30000
    );
    const body = await parseJson(res);
    if (!res.ok) {
      const code = toError(res, body);
      const err = new Error(code);
      err.code = code;
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // ---------- reports ----------
  async function reportTarget({ targetType, targetId, reason }) {
    const res = await fetchWithTimeout(`${BASE}/reports`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ targetType, targetId, reason }),
    });
    const b = await parseJson(res);
    if (!res.ok) throw new Error(toError(res, b));
    return b;
  }

  // ---------- stats ----------
  async function getStats() {
    const res = await fetchWithTimeout(`${BASE}/stats`, { headers: {} });
    const body = await parseJson(res);
    if (!res.ok) throw new Error(toError(res, body));
    return body || { topics: 0, posts: 0, categories: 0, openReports: 0 };
  }

  return {
    // identity
    createGuestProfile,
    currentAuthor,
    clearIdentity,
    hasIdentity: () => !!getStoredToken(),
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
    uploadAttachment,
    // reports
    reportTarget,
    // stats
    getStats,
  };
})();
