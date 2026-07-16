/* ============================================================
   Market API — public endpoint สำหรับ Market Ticker (watchlist)
   ------------------------------------------------------------
   Public endpoints (อ่าน cache/trigger sync เท่านั้น):
     GET /api/market-ticker               — ราคาทั้งหมด
     GET /api/market-ticker?symbols=...   — เฉพาะ symbols ที่ระบุ (comma-separated)
     GET /api/market-ticker?assetClass=.. — filter forex/metals/crypto/index

   กฎ QC (ตามที่ Codex กำหนด):
   - public response มี envelope { items, updatedAt, stale, source }
   - ห้ามส่ง secret/API key ใน response หรือ log
   - symbols/assetClass validation เข้มงวด (กัน injection / ค่าผิดปกติ)
   - ห้าม hardcode ราคา — ทุกค่าต้องมาจาก adapter จริง (service จัดการ)
   - symbols ที่ไม่มีแหล่งข้อมูล (เช่น DXY) → unavailable อย่างชัดเจน (ไม่ใช่ราคาปลอม)
   ============================================================ */

import { SYMBOL_ASSET_CLASS } from "../market/sources.js";

const VALID_ASSET_CLASSES = ["all", "forex", "metals", "crypto", "index", "commodity"];
// symbols ที่อนุญาต (whitelist กัน injection) — เพิ่มได้ถ้ามี adapter ใหม่
const ALLOWED_SYMBOLS = new Set(Object.keys(SYMBOL_ASSET_CLASS));

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * parse ?symbols=XAUUSD,EURUSD → array (validated, deduped)
 * @returns {string[]}
 */
function parseSymbols(value) {
  if (!value) return [];
  const parts = String(value)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const valid = [];
  const seen = new Set();
  for (const p of parts) {
    if (ALLOWED_SYMBOLS.has(p) && !seen.has(p)) {
      valid.push(p);
      seen.add(p);
    }
  }
  return valid;
}

/**
 * สร้าง handler สำหรับ market API
 * @param {object} opts { marketService, json }
 * @returns {function} คืน true เสมอเมื่อจัดการเรียบร้อย,
 *   false เมื่อ path/method ไม่ใช่ของ market (เพื่อให้ caller route ต่อ)
 */
export function createMarketApiHandler(opts) {
  const { marketService, json } = opts;

  /**
   * reply + return true (กัน bug "return json(...)" ที่ json() เป็น void)
   * สอดคล้องกับ calendarApi pattern ที่ใช้สำเร็จแล้ว
   */
  function reply(res, status, payload) {
    json(res, status, payload);
    return true;
  }

  return async function marketApiHandler(req, res, url) {
    const pathname = url.pathname;

    // ---- PUBLIC: GET /api/market-ticker ----
    if (req.method === "GET" && pathname === "/api/market-ticker") {
      const symbols = parseSymbols(url.searchParams.get("symbols"));
      const assetClass = (url.searchParams.get("assetClass") || "all")
        .toLowerCase()
        .trim();

      if (!VALID_ASSET_CLASSES.includes(assetClass)) {
        return reply(res, 400, {
          error: "invalid_asset_class",
          allowed: VALID_ASSET_CLASSES,
        });
      }

      try {
        const result = await marketService.readQuotes({ symbols, assetClass });
        return reply(res, 200, toPublicEnvelope(result));
      } catch (err) {
        // fallback สุดท้าย: คืน empty envelope + stale (ห้าม leak internal)
        return reply(res, 200, {
          items: [],
          updatedAt: null,
          stale: true,
          source: "aggregated",
          error: "fetch_failed",
        });
      }
    }

    // ---- PUBLIC: GET /api/market-ticker/status (health/debug) ----
    // ไม่ส่ง secret ใดๆ เพียงสถานะ service
    if (req.method === "GET" && pathname === "/api/market-ticker/status") {
      return reply(res, 200, marketService.getStatus());
    }

    return false; // ไม่ใช่ market endpoint → caller route ต่อ
  };
}

/**
 * แปลง service result → public envelope
 * - ตัด internal metadata ที่ไม่จำเป็น
 * - field ตาม contract: items[], updatedAt, stale, source
 */
export function toPublicEnvelope(result) {
  return {
    items: result.items || [],
    updatedAt: result.updatedAt,
    stale: !!result.stale,
    source: result.source || "aggregated",
    // meta สำหรับ frontend (ไม่ใช่ secret)
    count: (result.items || []).length,
  };
}
