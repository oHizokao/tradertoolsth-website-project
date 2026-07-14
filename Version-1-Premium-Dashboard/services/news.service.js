/* ============================================================
   Service Layer — News Service
   ใช้ Live API จาก /api/news และ fallback เป็นข้อมูลตัวอย่างเมื่อ server ใช้งานไม่ได้
   ============================================================ */

window.TT = window.TT || {};

TT.NewsService = (function () {
  const API_ENDPOINT = "/api/news";

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchNews(category = "all", limit = null) {
    if (!API_ENDPOINT) {
      await delay(180);
      let list = (TT.news || []).slice().sort(
        (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
      );
      if (category && category !== "all") {
        list = list.filter((n) => n.category === category);
      }
      if (limit) list = list.slice(0, limit);
      return list;
    }

    try {
      const params = new URLSearchParams({ category });
      if (limit) params.set("limit", String(limit));
      const res = await fetch(API_ENDPOINT + "?" + params.toString());
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      console.warn("[NewsService] API unavailable, using local fallback:", err);
      let list = (TT.news || []).slice().sort(
        (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
      );
      if (category && category !== "all") list = list.filter((n) => n.category === category);
      return limit ? list.slice(0, limit) : list;
    }
  }

  async function getBySlug(slug) {
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
