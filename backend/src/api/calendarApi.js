/* ============================================================
   Calendar API — public + admin endpoints สำหรับ Economic Calendar
   ------------------------------------------------------------
   Public endpoints (อ่าน cache เท่านั้น, ไม่ trigger sync):
     GET /api/calendar?from=&to=&importance=&currency=
     GET /api/calendar/upcoming?limit=&currency=&importance=

   Admin endpoint (trigger manual refresh):
     POST /api/admin/calendar/refresh

   กฎ QC:
   - public response มี envelope { items, updatedAt, stale, source }
   - ห้ามส่ง secret หรือ internal scrape metadata ที่ไม่จำเป็น
   - ใช้ชื่อพารามิเตอร์ที่สอดคล้องกับที่ Codex กำหนด (importance หรือ impact)
   ============================================================ */

/** parse วันที่รูปแบบ YYYY-MM-DD → UTC ISO (เริ่มต้น/สิ้นสุดของวันตาม UTC) */
function parseDateParam(value, endOfDay = false) {
  if (!value) return null;
  // รองรับเฉพาะ YYYY-MM-DD (เข้มงวด กัน injection / ค่าผิดปกติ)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  // validate ช่วงคร่าวๆ
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  if (endOfDay) {
    return new Date(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999)).toISOString();
  }
  return new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0)).toISOString();
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * สร้าง handler สำหรับ calendar API
 * @param {object} opts { calendarService, json, isAuthorizedAny, isOriginAllowed, adminToken, adminAllowedOrigins }
 * @returns {(req, res, url, reqOpts) => boolean} คืน true ถ้าจัดการเรียบร้อย
 */
export function createCalendarApiHandler(opts) {
  const {
    calendarService,
    json,
    isAuthorizedAny,
    isOriginAllowed,
  } = opts;

  return function calendarApiHandler(req, res, url, reqOpts) {
    const pathname = url.pathname;

    // ---- PUBLIC: GET /api/calendar ----
    if (req.method === "GET" && pathname === "/api/calendar") {
      const fromUtc = parseDateParam(url.searchParams.get("from"), false);
      const toUtc = parseDateParam(url.searchParams.get("to"), true);
      // รองรับทั้ง ?importance=high และ ?impact=high (alias)
      const impact =
        (url.searchParams.get("importance") || url.searchParams.get("impact") || "all").toLowerCase();
      // "all" sentinel เป็น lowercase เสมอ (match กับ listRange) ส่วนค่าจริง uppercase
      const rawCurrency = (url.searchParams.get("currency") || "all").trim();
      const currency = rawCurrency.toLowerCase() === "all" ? "all" : rawCurrency.toUpperCase();

      if (impact !== "all" && !["low", "medium", "high"].includes(impact)) {
        json(res, 400, { error: "invalid_importance" });
        return true;
      }

      const result = calendarService.readEvents({
        fromUtc,
        toUtc,
        impact,
        currency,
      });

      json(res, 200, toPublicEnvelope(result));
      return true;
    }

    // ---- PUBLIC: GET /api/calendar/upcoming ----
    if (req.method === "GET" && pathname === "/api/calendar/upcoming") {
      const limit = clampInt(url.searchParams.get("limit"), 10, 1, 100);
      const impact =
        (url.searchParams.get("importance") || url.searchParams.get("impact") || "all").toLowerCase();
      const rawCurrency = (url.searchParams.get("currency") || "all").trim();
      const currency = rawCurrency.toLowerCase() === "all" ? "all" : rawCurrency.toUpperCase();
      if (impact !== "all" && !["low", "medium", "high"].includes(impact)) {
        json(res, 400, { error: "invalid_importance" });
        return true;
      }
      const result = calendarService.readUpcoming({ limit, impact, currency });
      json(res, 200, toPublicEnvelope(result));
      return true;
    }

    // ---- ADMIN: POST /api/admin/calendar/refresh ----
    if (req.method === "POST" && pathname === "/api/admin/calendar/refresh") {
      const adminToken = reqOpts.adminToken || "";
      const allowedOrigins = reqOpts.adminAllowedOrigins || [];
      if (!adminToken) {
        json(res, 503, { error: "admin_api_disabled" });
        return true;
      }
      if (!isAuthorizedAny(req, adminToken)) {
        json(res, 401, { error: "unauthorized" });
        return true;
      }
      if (!isOriginAllowed(req, allowedOrigins)) {
        json(res, 403, { error: "origin_not_allowed" });
        return true;
      }
      // trigger manual refresh (async, ไม่บล็อก)
      calendarService
        .sync({ force: true })
        .catch((err) =>
          console.error(`[calendar] manual refresh failed: ${err.message}`)
        );
      json(res, 202, {
        ok: true,
        message: "calendar_refresh_started",
        status: calendarService.getStatus(),
      });
      return true;
    }

    return false; // ไม่ใช่ calendar endpoint
  };
}

/**
 * แปลง internal event → public event (ตัด internal metadata)
 * - ตัด createdAt (internal), sourceUrl/detailUrl ยังเก็บไว้ (เป็น public ของ FF)
 * - ตัด sourceEventId ที่เป็น internal hash? → เก็บไว้เป็น id สำหรับ frontend
 */
export function toPublicEvent(ev) {
  if (!ev) return null;
  return {
    id: ev.sourceEventId,
    source: ev.sourceName,
    sourceUrl: ev.sourceUrl,
    eventName: ev.eventName,
    country: ev.country,
    currency: ev.currency,
    impact: ev.impact,
    scheduledAtUtc: ev.scheduledAtUtc,
    scheduledAtBangkok: ev.scheduledAtBangkok,
    actual: ev.actual,
    forecast: ev.forecast,
    previous: ev.previous,
    revised: ev.revised,
    detailUrl: ev.detailUrl,
    isTentative: ev.isTentative,
    lastUpdated: ev.lastUpdated,
  };
}

/** แปลง service result → public envelope */
export function toPublicEnvelope(result) {
  return {
    items: (result.items || []).map(toPublicEvent),
    updatedAt: result.updatedAt,
    stale: !!result.stale,
    source: result.source,
  };
}
