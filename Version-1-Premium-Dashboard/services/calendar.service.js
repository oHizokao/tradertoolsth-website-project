/* ============================================================
   Service Layer — Economic Calendar Service
   ปัจจุบันใช้ Mock Data จาก data/calendar.js
   จุดที่รอเชื่อมระบบจริง: ฟังก์ชัน fetchEvents()
   ============================================================ */

window.TT = window.TT || {};

TT.CalendarService = (function () {
  const API_ENDPOINT = null; // TODO: "/api/calendar"

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchEvents(filter = {}) {
    if (!API_ENDPOINT) {
      await delay(180);
      let list = (TT.calendar || []).slice();

      if (filter.date) {
        const target = new Date(filter.date);
        list = list.filter((e) => sameDay(new Date(e.time), target));
      }
      if (filter.range) {
        // filter.range = { from: Date, to: Date }
        list = list.filter((e) => {
          const t = new Date(e.time);
          return t >= filter.range.from && t <= filter.range.to;
        });
      }
      if (filter.currency && filter.currency !== "all") {
        list = list.filter((e) => e.currency === filter.currency);
      }
      if (filter.impact && filter.impact !== "all") {
        list = list.filter((e) => e.impact === filter.impact);
      }

      return list.sort((a, b) => new Date(a.time) - new Date(b.time));
    }

    try {
      const res = await fetch(API_ENDPOINT);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      console.error("[CalendarService] fetch error:", err);
      throw err;
    }
  }

  function sameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  return {
    fetchEvents,
    isLive: !!API_ENDPOINT,
  };
})();
