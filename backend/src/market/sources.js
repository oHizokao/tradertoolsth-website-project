/* ============================================================
   Market Sources — adapters สำหรับแหล่งข้อมูลราคาจริง (ฝั่ง backend เท่านั้น)
   ------------------------------------------------------------
   กฎ QC (ตามที่ Codex กำหนด):
   - ดึงข้อมูลฝั่ง backend เท่านั้น ห้ามให้ browser เรียก third-party โดยตรง
   - ใช้แหล่งข้อมูลจริงที่อนุญาต (free public APIs ที่ไม่ต้อง key)
   - ห้าม hardcode ราคา — ทุกค่าต้องมาจาก fetch
   - แต่ละ adapter คืน normalized quote: { symbol, price, source, sourceUrl, fetchedAt }
   - adapter ที่ล้มเหลว → throw (ให้ service จัดการ fallback/stale)
   - ไม่ส่ง secret/API key ใดๆ ใน response หรือ log

   แหล่งข้อมูลที่ใช้:
   - gold-api.com     → XAUUSD, XAGUSD (metals) — free, no key, public
   - open.er-api.com  → EURUSD, GBPUSD, USDJPY (forex) — free, no key, public
   - coingecko.com    → BTCUSD (crypto) — free, no key, public (rate-limited)
   - yahoo finance    → OIL (CL=F, WTI Crude), DXY (DX-Y.NYB) — public chart API
                        ให้ price + change + changePercent จากข้อมูล 5d interval=1d
                        (กันราคาปลอม — ทุกค่ามาจาก chart candles จริง)
   ============================================================ */

import { logger } from "../utils/logger.js";

const log = logger.make("market-src");

const DEFAULT_UA =
  "TraderToolsTH-Backend/1.0 (+market-data; contact: dev@tradertoolsth)";

/**
 * fetch JSON พร้อม timeout แบบเดียวกับ httpClient แต่เบากว่า
 * (ไม่ใช้ config.scraper timeout เพราะ market ใช้ timeout ของตัวเอง)
 *
 * @param {string} url
 * @param {object} opts { timeoutMs, headers }
 * @returns {Promise<object>} parsed JSON
 */
async function fetchJson(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "application/json",
        ...(opts.headers || {}),
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- gold-api.com adapter (XAU/XAG) ----------
const GOLD_API_BASE = "https://api.gold-api.com/price";

/**
 * ดึงราคาโลหะ (XAU/XAG) จาก gold-api.com
 * @param {string} symbol "XAU" | "XAG"
 * @param {object} opts { timeoutMs }
 * @returns {Promise<{price:number, source:string, sourceUrl:string, fetchedAt:string, rawUpdatedAt:string|null}>}
 */
export async function fetchGoldApi(symbol, opts = {}) {
  const sym = symbol === "XAUUSD" ? "XAU" : symbol === "XAGUSD" ? "XAG" : symbol;
  const url = `${GOLD_API_BASE}/${sym}`;
  const data = await fetchJson(url, { timeoutMs: opts.timeoutMs });
  if (typeof data.price !== "number" || !Number.isFinite(data.price)) {
    throw new Error(`gold-api: invalid price for ${sym}`);
  }
  return {
    price: data.price,
    source: "gold-api.com",
    sourceUrl: "https://gold-api.com",
    fetchedAt: new Date().toISOString(),
    rawUpdatedAt: data.updatedAt || null,
  };
}

// ---------- open.er-api.com adapter (forex) ----------
const ER_API_BASE = "https://open.er-api.com/v6/latest";

// cache base rates ชั่วคราว (per fetch cycle) เพื่อลด request
let _erBaseCache = null; // { base, data, fetchedAt }
let _erBasePromise = null;

/**
 * ดึง rates ทั้งหมดจาก open.er-api.com (USD base)
 * - cache ในหน่วยความจำระดับ module (shared ระหว่าง calls ใน cycle เดียวกัน)
 * - กัน concurrent calls ซ้อนด้วย promise dedup
 *
 * @param {object} opts { timeoutMs }
 * @returns {Promise<{rates:object, fetchedAt:string, rawUpdatedAt:string}>}
 */
export async function fetchErBaseRates(opts = {}) {
  // dedup concurrent calls (cache hit ถ้าอายุน้อยกว่า cacheMs)
  const cacheMs = opts.cacheMs ?? 20_000;
  if (_erBaseCache && Date.now() - new Date(_erBaseCache.fetchedAt).getTime() < cacheMs) {
    return _erBaseCache;
  }
  if (_erBasePromise) return _erBasePromise;

  _erBasePromise = (async () => {
    const data = await fetchJson(`${ER_API_BASE}/USD`, { timeoutMs: opts.timeoutMs });
    if (!data || data.result !== "success" || typeof data.rates !== "object") {
      throw new Error(`er-api: bad response (result=${data?.result})`);
    }
    const entry = {
      rates: data.rates,
      fetchedAt: new Date().toISOString(),
      rawUpdatedAt: data.time_last_update_utc || null,
    };
    _erBaseCache = entry;
    return entry;
  })();

  try {
    return await _erBasePromise;
  } finally {
    _erBasePromise = null;
  }
}

/**
 * ดึงราคา forex จาก open.er-api.com
 * - EURUSD, GBPUSD = rate[symbol] โดยตรง (USD base → rate คือ 1 USD = X foreign)
 *   * EURUSD price = rate.EUR (1 USD = rate.EUR EUR → EURUSD = rate.EUR)
 *   * GBPUSD price = rate.GBP
 * - USDJPY price = rate.JPY (1 USD = rate.JPY JPY)
 *
 * @param {string} symbol "EURUSD" | "GBPUSD" | "USDJPY"
 * @param {object} opts { timeoutMs }
 */
export async function fetchErApi(symbol, opts = {}) {
  const base = await fetchErBaseRates(opts);
  const code = symbol === "USDJPY" ? "JPY" : symbol.slice(0, 3); // EUR/GBP
  const usdBaseRate = base.rates[code];
  // The feed is USD based (1 USD = N units). EURUSD and GBPUSD are
  // conventionally quoted as USD per one unit, so those pairs are inverted.
  const price = symbol === "USDJPY" ? usdBaseRate : 1 / usdBaseRate;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error(`er-api: missing/invalid rate for ${symbol} (${code})`);
  }
  return {
    price,
    source: "open.er-api.com",
    sourceUrl: "https://www.exchangerate-api.com",
    fetchedAt: base.fetchedAt,
    rawUpdatedAt: base.rawUpdatedAt,
  };
}

// ---------- CoinGecko adapter (BTC) ----------
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

/**
 * ดึงราคา BTC จาก CoinGecko (free, no key)
 * @param {string} symbol "BTCUSD"
 * @param {object} opts { timeoutMs }
 */
export async function fetchCoinGecko(symbol, opts = {}) {
  if (symbol !== "BTCUSD") throw new Error(`coingecko: unsupported symbol ${symbol}`);
  const url = `${COINGECKO_BASE}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`;
  const data = await fetchJson(url, { timeoutMs: opts.timeoutMs });
  const btc = data?.bitcoin;
  if (!btc || typeof btc.usd !== "number" || !Number.isFinite(btc.usd)) {
    throw new Error("coingecko: invalid btc.usd");
  }
  return {
    price: btc.usd,
    changePercent: typeof btc.usd_24h_change === "number" ? btc.usd_24h_change : null,
    source: "CoinGecko",
    sourceUrl: "https://www.coingecko.com",
    fetchedAt: new Date().toISOString(),
    rawUpdatedAt: btc.last_updated_at ? new Date(btc.last_updated_at * 1000).toISOString() : null,
  };
}

// ---------- Yahoo Finance adapter (OIL, DXY) ----------
// Public chart API: ไม่ต้องการ key
// ดึง candles 5d interval=1d → คำนวณ price/change/changePercent จากข้อมูลจริง
// (กันราคาปลอม — ทุกค่ามาจาก OHLC จริงของ Yahoo)
const YAHOO_CHART_BASE = "https://query2.finance.yahoo.com/v8/finance/chart";

/**
 * mapping symbol → Yahoo ticker
 * - OIL → CL=F (WTI Crude Oil Futures, NYMEX)
 * - DXY → DX-Y.NYB (ICE Dollar Index)
 */
const YAHOO_SYMBOL_MAP = {
  OIL: "CL=F",
  DXY: "DX-Y.NYB",
};

/**
 * ดึงราคาจาก Yahoo Finance chart API
 * คำนวณ change/changePercent จาก close ล่าสุด vs close ก่อนหน้า (จริง)
 *
 * @param {string} symbol "OIL" | "DXY"
 * @param {object} opts { timeoutMs }
 * @returns {Promise<{price:number, change:number, changePercent:number, source:string, sourceUrl:string, fetchedAt:string, rawUpdatedAt:string|null}>}
 */
export async function fetchYahooFinance(symbol, opts = {}) {
  const ticker = YAHOO_SYMBOL_MAP[symbol];
  if (!ticker) throw new Error(`yahoo: unsupported symbol ${symbol}`);

  const url = `${YAHOO_CHART_BASE}/${encodeURIComponent(
    ticker
  )}?range=5d&interval=1d`;
  const data = await fetchJson(url, {
    timeoutMs: opts.timeoutMs,
    headers: { "User-Agent": DEFAULT_UA },
  });

  const result = data?.chart?.result?.[0];
  if (!result) {
    const errMsg = data?.chart?.error?.description || "no result";
    throw new Error(`yahoo: bad response for ${symbol} (${errMsg})`);
  }

  const closes = result.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes) || closes.length === 0) {
    throw new Error(`yahoo: no close data for ${symbol}`);
  }

  // หา close ล่าสุดที่ไม่ null + close ก่อนหน้าที่ไม่ null (กัน gap)
  let lastIdx = closes.length - 1;
  while (lastIdx >= 0 && (closes[lastIdx] === null || closes[lastIdx] === undefined)) {
    lastIdx--;
  }
  let prevIdx = lastIdx - 1;
  while (prevIdx >= 0 && (closes[prevIdx] === null || closes[prevIdx] === undefined)) {
    prevIdx--;
  }
  if (lastIdx < 0) {
    throw new Error(`yahoo: no valid close for ${symbol}`);
  }

  const livePrice = result.meta?.regularMarketPrice;
  const price =
    typeof livePrice === "number" && Number.isFinite(livePrice) && livePrice > 0
      ? livePrice
      : closes[lastIdx];
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error(`yahoo: invalid price for ${symbol}: ${price}`);
  }

  // change/changePercent: ถ้ามี prev close → คำนวณ, ถ้าไม่มี → 0 (กัน NaN)
  let change = 0;
  let changePercent = 0;
  const metaPreviousClose = result.meta?.chartPreviousClose;
  if (
    typeof metaPreviousClose === "number" &&
    Number.isFinite(metaPreviousClose) &&
    metaPreviousClose > 0
  ) {
    change = price - metaPreviousClose;
    changePercent = (change / metaPreviousClose) * 100;
  } else if (prevIdx >= 0) {
    const prev = closes[prevIdx];
    change = price - prev;
    changePercent = prev !== 0 ? (change / prev) * 100 : 0;
  }

  const rawUpdatedAt = result.meta?.regularMarketTime
    ? new Date(result.meta.regularMarketTime * 1000).toISOString()
    : result.timestamp?.[lastIdx]
    ? new Date(result.timestamp[lastIdx] * 1000).toISOString()
    : null;

  return {
    price,
    change,
    changePercent,
    source: "Yahoo Finance",
    sourceUrl: "https://finance.yahoo.com",
    fetchedAt: new Date().toISOString(),
    rawUpdatedAt,
  };
}

// ---------- Symbol → adapter mapping ----------
// OIL (CL=F, WTI) และ DXY (DX-Y.NYB) ใช้ Yahoo Finance chart API
export const SYMBOL_ADAPTERS = {
  XAUUSD: { fetch: fetchGoldApi, assetClass: "metals" },
  XAGUSD: { fetch: fetchGoldApi, assetClass: "metals" },
  EURUSD: { fetch: fetchErApi, assetClass: "forex" },
  GBPUSD: { fetch: fetchErApi, assetClass: "forex" },
  USDJPY: { fetch: fetchErApi, assetClass: "forex" },
  BTCUSD: { fetch: fetchCoinGecko, assetClass: "crypto" },
  DXY: { fetch: fetchYahooFinance, assetClass: "index" },
  OIL: { fetch: fetchYahooFinance, assetClass: "commodity" },
};

/**
 * resolve adapter สำหรับ symbol
 * @param {string} symbol
 * @returns {{ fetch: Function, assetClass: string } | null}
 */
export function resolveAdapter(symbol) {
  return SYMBOL_ADAPTERS[symbol] || null;
}

/** asset class ทั้งหมดที่รองรับ (สำหรับ filter documentation) */
export const ASSET_CLASSES = ["forex", "metals", "crypto", "index", "commodity"];

/**
 * จัดกลุ่ม symbol → asset class (สำหรับ default watchlist)
 */
export const SYMBOL_ASSET_CLASS = {
  XAUUSD: "metals",
  XAGUSD: "metals",
  EURUSD: "forex",
  GBPUSD: "forex",
  USDJPY: "forex",
  BTCUSD: "crypto",
  DXY: "index",
  OIL: "commodity",
};

/** เคลียร์ cache ภายใน (สำหรับ test) */
export function _clearSourceCache() {
  _erBaseCache = null;
  _erBasePromise = null;
}
