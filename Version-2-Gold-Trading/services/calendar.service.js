/* ============================================================
   Service Layer — Economic Calendar Service (V2 — Live API)
   ------------------------------------------------------------
   - เรียก /api/calendar ฝั่ง backend เท่านั้น (ห้าม frontend scrape)
   - backend เป็นคนดึงจาก Forex Factory + cache + sync
   - รองรับ envelope { items, updatedAt, stale, source }
   - ถ้า API ล้มเหลว → คืน envelope ที่ items=[], stale=true (ไม่หลอกข้อมูล)
   ============================================================ */

window.TT = window.TT || {};

TT.CalendarService = (function () {
  const API_ENDPOINT = "/api/calendar";
  const UPCOMING_ENDPOINT = "/api/calendar/upcoming";

  /**
   * Normalize ผลลัพธ์จาก API ให้เป็น envelope เสมอ
   * { items, updatedAt, stale, source }
   * - รองรับกรณี API คืน plain array (backward-compat)
   * - ป้องกัน field หาย
   */
  function normalizeEnvelope(payload) {
    if (Array.isArray(payload)) {
      return { items: payload, updatedAt: null, stale: false, source: "Forex Factory" };
    }
    if (payload && typeof payload === "object") {
      const items = Array.isArray(payload.items) ? payload.items : [];
      return {
        items,
        updatedAt: payload.updatedAt || null,
        stale: !!payload.stale,
        source: payload.source || "Forex Factory",
      };
    }
    return { items: [], updatedAt: null, stale: true, source: "Forex Factory" };
  }

  /**
   * สร้าง query string จาก filter
   * @param {object} filter { range?, impact?, currency?, importance? }
   */
  function buildParams(filter) {
    const params = new URLSearchParams();
    if (filter.range) {
      if (filter.range.from instanceof Date) {
        params.set("from", toDateParam(filter.range.from));
      }
      if (filter.range.to instanceof Date) {
        params.set("to", toDateParam(filter.range.to));
      }
    }
    if (filter.from) params.set("from", toDateParam(filter.from));
    if (filter.to) params.set("to", toDateParam(filter.to));
    // impact/importance ส่งเป็น importance (backend รองรับทั้งคู่)
    const impact = filter.impact || filter.importance;
    if (impact && impact !== "all") params.set("importance", impact);
    if (filter.currency && filter.currency !== "all") params.set("currency", filter.currency);
    return params;
  }

  /** Date → "YYYY-MM-DD" (สำหรับ query param) */
  function toDateParam(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  /**
   * ดึง events พร้อม envelope
   * @param {object} filter { range, impact, currency }
   * @returns {Promise<{items, updatedAt, stale, source}>}
   */
  async function fetchEvents(filter = {}) {
    const params = buildParams(filter);
    const url = API_ENDPOINT + (params.toString() ? "?" + params.toString() : "");
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const payload = await res.json();
      return normalizeEnvelope(payload);
    } catch (err) {
      console.warn("[CalendarService] API unavailable:", err);
      // ไม่ fallback เป็น mock data (ห้ามหลอกข้อมูลจริง)
      // คืน envelope ที่บอกว่าล้มเหลว ให้ UI แสดง error state
      return { items: [], updatedAt: null, stale: true, source: "Forex Factory", error: true };
    }
  }

  /**
   * ดึง upcoming events (เวลา >= ตอนนี้)
   * @param {object} opts { limit, currency, impact }
   */
  async function fetchUpcoming(opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.currency && opts.currency !== "all") params.set("currency", opts.currency);
    const impact = opts.impact || opts.importance;
    if (impact && impact !== "all") params.set("importance", impact);
    try {
      const res = await fetch(UPCOMING_ENDPOINT + "?" + params.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return normalizeEnvelope(await res.json());
    } catch (err) {
      console.warn("[CalendarService] upcoming API unavailable:", err);
      return { items: [], updatedAt: null, stale: true, source: "Forex Factory", error: true };
    }
  }

  return {
    fetchEvents,
    fetchUpcoming,
    isLive: true,
  };
})();
