/* ============================================================
   Service Layer — News Service (V1)
   ------------------------------------------------------------
   - ใช้ Live API จาก /api/news (response = envelope pagination)
   - รองรับ client เก่า: หาก API คืน plain array จะถูก normalize เป็น envelope
   - fallback เป็นข้อมูลตัวอย่าง (TT.news) เมื่อ server ไม่พร้อมใช้งาน
   - fetchNews() คืน {items,total,limit,offset,hasMore}
   - ยังมี fetchAll() สำหรับ V1 ที่ต้องการ array แบบเดิม
   ============================================================ */

window.TT = window.TT || {};

TT.NewsService = (function () {
  const API_ENDPOINT = "/api/news";
  const HARD_MAX = 50; // ตรงกับ limit สูงสุดของ backend

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function byNewest(list) {
    return list.slice().sort((a, b) => {
      const ta = new Date(a.publishedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.publishedAt || b.createdAt || 0).getTime();
      return tb - ta;
    });
  }

  function normalizePage(payload, limit, offset) {
    if (Array.isArray(payload)) {
      const items = payload;
      return { items, total: items.length, limit, offset, hasMore: false };
    }
    if (payload && typeof payload === "object" && Array.isArray(payload.items)) {
      const total = Number.isFinite(payload.total) ? payload.total : payload.items.length;
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

  function fallbackPage(category, limit, offset) {
    let list = byNewest(TT.news || []);
    if (category && category !== "all") {
      list = list.filter((n) => n.category === category);
    }
    const total = list.length;
    const items = list.slice(offset, offset + limit);
    return { items, total, limit, offset, hasMore: offset + items.length < total };
  }

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

  /**
   * ดึงข่าวแบบ pagination → {items,total,limit,offset,hasMore}
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

  /**
   * ดึงข่าวทั้งหมด (สำหรับ V1 ที่ render รวดเดียว)
   * ใช้ limit สูงสุด + offset 0 เพื่อดึงทุกข่าว published
   * @returns {Promise<Array>}
   */
  async function fetchAll(category = "all") {
    const page = await fetchNews(category, { limit: HARD_MAX, offset: 0 });
    let items = page.items;
    // ถ้ายังมีข่าวเหลือ → โหลดต่อจนครบ (กรณีข่าวเยอะกว่า HARD_MAX)
    let off = items.length;
    while (page.hasMore && off < page.total && off < HARD_MAX * 50) {
      const next = await fetchNews(category, { limit: HARD_MAX, offset: off });
      items = items.concat(next.items);
      off += next.items.length;
      if (!next.hasMore || next.items.length === 0) break;
    }
    return items;
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
    fetchAll,
    getBySlug,
    isLive: !!API_ENDPOINT,
  };
})();
