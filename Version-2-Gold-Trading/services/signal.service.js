/* ============================================================
   Service Layer — Signal Service
   ต้นทาง: EA/MT5 ที่ MQL5/Experts/Tradertoolsth_Website
   ปิดแบบ fail-closed จนกว่าจะมี API จริง — ห้ามแสดงข้อมูลจำลองเป็นสัญญาณจริง
   ============================================================ */

window.TT = window.TT || {};

TT.SignalService = (function () {
  const API_ENDPOINT = null;

  function unavailable() {
    const err = new Error("signal_api_unavailable");
    err.code = "signal_api_unavailable";
    throw err;
  }

  async function fetchSignals(filter = {}) {
    if (!API_ENDPOINT) return unavailable();

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
    if (!API_ENDPOINT) return unavailable();
    const res = await fetch(`${API_ENDPOINT}/stats`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function getById(id) {
    if (!API_ENDPOINT) return unavailable();
    const res = await fetch(`${API_ENDPOINT}/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  return {
    fetchSignals,
    getStats,
    getById,
    // สถานะเชื่อมระบบจริง
    isLive: !!API_ENDPOINT,
    source: API_ENDPOINT ? "EA/MT5 API" : "unconfigured",
  };
})();
