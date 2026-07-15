/* ============================================================
   Service Layer — News Service (V2)
   ------------------------------------------------------------
   - ใช้ Live API จาก /api/news (response = envelope pagination)
   - รองรับ client เก่า: หาก API คืน plain array จะถูก normalize เป็น envelope
   - fallback เป็นข้อมูลตัวอย่าง (TT.news) เมื่อ server ไม่พร้อมใช้งาน
   - ห้ามส่งข่าว draft/ready/rejected/failed ออก frontend (ตัดที่ backend)
   ============================================================ */

window.TT = window.TT || {};

TT.NewsService = (function () {
  const API_ENDPOINT = "/api/news";
  const HARD_MAX = 50; // ตรงกับ limit สูงสุดของ backend

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** sort ใหม่ → เก่า โดย publishedAt (fallback createdAt) */
  function byNewest(list) {
    return list.slice().sort((a, b) => {
      const ta = new Date(a.publishedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.publishedAt || b.createdAt || 0).getTime();
      return tb - ta;
    });
  }

  /**
   * Normalize ผลลัพธ์จาก API (อาจเป็น envelope หรือ plain array)
   * ให้เป็น { items, total, limit, offset, hasMore } เสมอ
   */
  function normalizePage(payload, limit, offset) {
    if (Array.isArray(payload)) {
      const items = payload;
      return {
        items,
        total: items.length,
        limit,
        offset,
        hasMore: false,
      };
    }
    if (payload && typeof payload === "object" && Array.isArray(payload.items)) {
      const total = Number.isFinite(payload.total)
        ? payload.total
        : payload.items.length;
      return {
        items: payload.items,
        total,
        limit: Number.isFinite(payload.limit) ? payload.limit : limit,
        offset: Number.isFinite(payload.offset) ? payload.offset : offset,
        hasMore: Boolean(payload.hasMore),
      };
    }
    return { items: [], total: 0, limit, offset, hasMore: false };
  }

  /** fallback ในเครื่อง (เมื่อ API ไม่พร้อม) */
  function fallbackPage(category, limit, offset) {
    let list = byNewest(TT.news || []);
    if (category && category !== "all") {
      list = list.filter((n) => n.category === category);
    }
    const total = list.length;
    const items = list.slice(offset, offset + limit);
    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  }

  /**
   * ดึงข่าวแบบ pagination
   * @param {string} category "all" | "gold" | "forex"
   * @param {object} opts { limit, offset }
   * @returns {Promise<{items,total,limit,offset,hasMore}>}
   */
  async function fetchNews(category = "all", opts = {}) {
    const limit = clampLimit(opts.limit, 50);
    const offset = clampOffset(opts.offset, 0);

    if (!API_ENDPOINT) {
      await delay(180);
      return fallbackPage(category, limit, offset);
    }

    try {
      const params = new URLSearchParams({
        category: category || "all",
        limit: String(limit),
        offset: String(offset),
      });
      const res = await fetch(API_ENDPOINT + "?" + params.toString());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const payload = await res.json();
      return normalizePage(payload, limit, offset);
    } catch (err) {
      console.warn("[NewsService] API unavailable, using local fallback:", err);
      return fallbackPage(category, limit, offset);
    }
  }

  /** clamp ฝั่ง client (คุ้มกันค่าผิดปกติก่อนส่งไป API) */
  function clampLimit(v, fallback) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(Math.max(n, 1), HARD_MAX);
  }
  function clampOffset(v, fallback) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  }

  async function getBySlug(slug) {
    if (!API_ENDPOINT) {
      await delay(100);
      return (TT.news || []).find((n) => n.slug === slug) || null;
    }
    try {
      const res = await fetch(API_ENDPOINT + "/" + encodeURIComponent(slug));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      console.warn("[NewsService] detail API unavailable, using local fallback:", err);
      await delay(100);
      return (TT.news || []).find((n) => n.slug === slug) || null;
    }
  }

  return {
    fetchNews,
    getBySlug,
    isLive: !!API_ENDPOINT,
  };
})();
