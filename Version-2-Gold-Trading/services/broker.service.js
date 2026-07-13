/* ============================================================
   Service Layer — Broker Service
   ปัจจุบันใช้ Mock Data จาก data/brokers.js
   จุดที่รอเชื่อมระบบจริง: ฟังก์ชัน fetchBrokers() / getBySlug()
   ============================================================ */

window.TT = window.TT || {};

TT.BrokerService = (function () {
  const API_ENDPOINT = null; // TODO: "/api/brokers"

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchBrokers() {
    if (!API_ENDPOINT) {
      await delay(180);
      return (TT.brokers || [])
        .slice()
        .sort((a, b) => b.score - a.score);
    }
    try {
      const res = await fetch(API_ENDPOINT);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      console.error("[BrokerService] fetch error:", err);
      throw err;
    }
  }

  async function getBySlug(slug) {
    await delay(100);
    return (TT.brokers || []).find((b) => b.slug === slug) || null;
  }

  return {
    fetchBrokers,
    getBySlug,
    isLive: !!API_ENDPOINT,
  };
})();
