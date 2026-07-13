/* ============================================================
   Service Layer — Signal Service
   ต้นทาง: EA/MT5 ที่ MQL5/Experts/Tradertoolsth_Website
   ปัจจุบันใช้ Mock Data จาก data/signals.js
   จุดที่รอเชื่อมระบบจริง: ฟังก์ชัน fetchSignals()
   ============================================================ */

window.TT = window.TT || {};

TT.SignalService = (function () {
  const API_ENDPOINT = null; // TODO: ใส่ endpoint จริงเมื่อพร้อม เช่น "/api/signals"

  // จำลอง network delay
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchSignals(filter = {}) {
    // === Mock path ===
    if (!API_ENDPOINT) {
      await delay(180);
      let list = (TT.signals || []).slice();

      if (filter.tier && filter.tier !== "all") {
        list = list.filter((s) => s.tier === filter.tier);
      }
      if (filter.status && filter.status !== "all") {
        list = list.filter((s) => s.status === filter.status);
      }
      return list;
    }

    // === Real path (เตรียมไว้สำหรับอนาคต) ===
    try {
      const res = await fetch(API_ENDPOINT);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      console.error("[SignalService] fetch error:", err);
      throw err;
    }
  }

  async function getStats() {
    await delay(120);
    return TT.signalStats || { active: 0, winRate: 0, totalThisMonth: 0, avgPips: 0 };
  }

  async function getById(id) {
    await delay(100);
    return (TT.signals || []).find((s) => s.id === id) || null;
  }

  return {
    fetchSignals,
    getStats,
    getById,
    // สถานะเชื่อมระบบจริง
    isLive: !!API_ENDPOINT,
    source: "EA/MT5 (mock)",
  };
})();
