/* ============================================================
   Service Layer — News Service
   ปัจจุบันใช้ Mock Data จาก data/news.js
   จุดที่รอเชื่อมระบบจริง: ฟังก์ชัน fetchNews() / getArticle()
   ============================================================ */

window.TT = window.TT || {};

TT.NewsService = (function () {
  const API_ENDPOINT = null; // TODO: "/api/news"

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
      const res = await fetch(
        API_ENDPOINT + "?category=" + encodeURIComponent(category)
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      let list = await res.json();
      if (limit) list = list.slice(0, limit);
      return list;
    } catch (err) {
      console.error("[NewsService] fetch error:", err);
      throw err;
    }
  }

  async function getBySlug(slug) {
    await delay(100);
    return (TT.news || []).find((n) => n.slug === slug) || null;
  }

  return {
    fetchNews,
    getBySlug,
    isLive: !!API_ENDPOINT,
  };
})();
