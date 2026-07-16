/* ============================================================
   Market Service — orchestrate fetch + cache + timeout + stale fallback + history
   ------------------------------------------------------------
   กฎ QC (ตามที่ Codex กำหนด):
   - cache อย่างน้อย 30 วินาที (config.market.cacheSeconds)
   - timeout: แต่ละ fetch มี deadline; เกิน → ใช้ cache ล่าสุด + stale=true
   - ห้าม hardcode ราคา — ทุกค่าต้องมาจาก adapter จริง
   - ไม่ส่ง secret/API key ใดๆ ใน response หรือ log
   - history[] เป็น ring buffer ในหน่วยความจำ (ใช้สำหรับ sparkline)
   - syncInFlight lock กัน fetch ซ้อน
   - symbols ที่ไม่มี adapter (เช่น DXY) → "unavailable" อย่างชัดเจน (ไม่ใช่ราคาปลอม)
   ============================================================ */

import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  resolveAdapter,
  SYMBOL_ASSET_CLASS,
} from "./sources.js";

const log = logger.make("market-svc");

const HISTORY_MAX = 24; // จำนวนจุด history สำหรับ sparkline

/** Default symbols ตาม spec — ครบ 8 (เพิ่ม OIL) */
export const DEFAULT_SYMBOLS = [
  "XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "DXY", "OIL",
];

/**
 * สร้าง market service
 * @param {object} [opts] override (สำหรับ test: inject fetchFn, clock, ฯลฯ)
 *   - opts.symbols: รายการ symbol default (ถ้าไม่ระบุ/ว่าง ใช้ DEFAULT_SYMBOLS)
 *   - opts.fetchFn: injectable fetch สำหรับ test (รับ symbol → คืน quote)
 *   - opts.now: injectable clock (สำหรับ test stale)
 */
export function createMarketService(opts = {}) {
  const cfg = {
    enabled: opts.enabled ?? config.market.enabled,
    cacheSeconds: opts.cacheSeconds ?? config.market.cacheSeconds,
    staleAfterSeconds: opts.staleAfterSeconds ?? config.market.staleAfterSeconds,
    fetchTimeoutMs: opts.fetchTimeoutMs ?? config.market.fetchTimeoutMs,
    syncIntervalSeconds: opts.syncIntervalSeconds ?? config.market.syncIntervalSeconds,
    symbols: (opts.symbols && opts.symbols.length)
      ? opts.symbols
      : (config.market.symbols && config.market.symbols.length
        ? config.market.symbols
        : DEFAULT_SYMBOLS),
    fetchFn: opts.fetchFn ?? null, // null = ใช้ adapter จริง
    now: opts.now ?? (() => Date.now()),
  };

  // symbol → cache entry { quote, cachedAt }
  const cache = new Map();
  // symbol → history number[] (ring buffer)
  const history = new Map();
  let syncInFlight = false;
  let lastSyncAt = null;
  let lastSyncOk = false;
  let lastError = null;

  /**
   * fetch เดี่ยว symbol ผ่าน adapter (หรือ fetchFn inject)
   *
   * กฎ QC: แม้ในโหมด inject (test) ก็ต้องเคารพ "ไม่มี adapter → unavailable"
   * เพื่อให้พฤติกรรมใน test สอดคล้องกับ production (DXY = no_data_source)
   *
   * @returns {Promise<object>} normalized quote { symbol, price, ... }
   */
  async function fetchSymbol(symbol) {
    const assetClass = SYMBOL_ASSET_CLASS[symbol] || "other";
    // ไม่มี adapter ให้ symbol → unavailable (ห้ามปลอมข้อมูล)
    // เช็คก่อน inject เพื่อให้ test เห็นพฤติกรรมเดียวกับ production
    const adapter = resolveAdapter(symbol);
    if (!adapter) {
      return {
        symbol,
        assetClass,
        price: null,
        unavailable: true,
        unavailableReason: "no_data_source",
        source: null,
        sourceUrl: null,
        fetchedAt: null,
      };
    }
    // inject mode (test) — หลังผ่าน adapter check แล้ว
    if (cfg.fetchFn) {
      const q = await cfg.fetchFn(symbol);
      return { ...q, symbol, assetClass };
    }
    const raw = await adapter.fetch(symbol, { timeoutMs: cfg.fetchTimeoutMs });
    return {
      symbol,
      assetClass,
      price: raw.price,
      // change/changePercent จาก adapter (เช่น Yahoo ส่งมา) — ถ้าไม่มี → null
      // (service จะคำนวณจาก history ใน computeChange ภายหลัง)
      change: raw.change ?? null,
      changePercent: raw.changePercent ?? raw.percent ?? null,
      source: raw.source,
      sourceUrl: raw.sourceUrl,
      fetchedAt: raw.fetchedAt,
      rawUpdatedAt: raw.rawUpdatedAt ?? null,
    };
  }

  /**
   * คำนวณ change/percent/direction เทียบกับ history ก่อนหน้า
   * - previousClose = history ล่าสุดก่อน current (ถ้ามี)
   * - ถ้ามี changePercent จาก source (เช่น CoinGecko) → ใช้ค่านั้น
   */
  function computeChange(symbol, quote) {
    const hist = history.get(symbol) || [];
    const sourceChange =
      typeof quote.change === "number" && Number.isFinite(quote.change)
        ? quote.change
        : null;
    const sourcePercent =
      typeof quote.changePercent === "number" && Number.isFinite(quote.changePercent)
        ? quote.changePercent
        : null;
    if (hist.length < 2) {
      let change = sourceChange;
      if (change === null && sourcePercent !== null && typeof quote.price === "number") {
        const previous = quote.price / (1 + sourcePercent / 100);
        change = Number.isFinite(previous) ? quote.price - previous : null;
      }
      const movement = change ?? sourcePercent ?? 0;
      return {
        change,
        changePercent: sourcePercent,
        direction: movement > 0 ? "up" : movement < 0 ? "down" : "flat",
      };
    }
    const prev = hist[hist.length - 2];
    const curr = hist[hist.length - 1];
    const change = curr - prev;
    const changePercent = sourcePercent ?? (prev !== 0 ? (change / prev) * 100 : 0);
    const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
    return { change: sourceChange ?? change, changePercent, direction };
  }

  /**
   * sync รอบเดียว: fetch ทุก symbol, cache, push history
   * - ใช้ Promise.allSettled (symbol ล้มเหลวเดี่ยวไม่ทำให้ทั้งรอบพัง)
   * - กัน sync ซ้อนด้วย syncInFlight
   *
   * @param {object} [callOpts] { force?: boolean }
   * @returns {Promise<{ ok:boolean, fetched:number, failed:number, total:number, skipped:boolean, stale:boolean }>}
   */
  async function sync(callOpts = {}) {
    if (syncInFlight) {
      log.info("sync already in-flight → skip");
      return { ok: false, fetched: 0, failed: 0, total: cfg.symbols.length, skipped: true, stale: isStale() };
    }
    syncInFlight = true;
    let fetched = 0;
    let failed = 0;
    const results = await Promise.allSettled(
      cfg.symbols.map((sym) => fetchSymbol(sym))
    );
    const nowIso = new Date(cfg.now()).toISOString();
    results.forEach((r, i) => {
      const sym = cfg.symbols[i];
      if (r.status === "fulfilled") {
        const q = r.value;
        cache.set(sym, { quote: q, cachedAt: nowIso, stale: false });
        // push history (เฉพาะที่มี price)
        if (typeof q.price === "number" && Number.isFinite(q.price)) {
          const arr = history.get(sym) || [];
          arr.push(q.price);
          if (arr.length > HISTORY_MAX) arr.shift();
          history.set(sym, arr);
        }
        fetched++;
      } else {
        failed++;
        const previous = cache.get(sym);
        if (previous) cache.set(sym, { ...previous, stale: true });
        log.warn(`fetch ${sym} failed: ${r.reason?.message || r.reason}`);
        // ไม่ลบ cache เก่า → ใช้เป็น fallback (stale)
      }
    });
    lastSyncAt = nowIso;
    lastSyncOk = failed < cfg.symbols.length; // ok ถ้าอย่างน้อย 1 ตัวสำเร็จ
    lastSyncOk = failed === 0;
    lastError = failed ? `${failed} market source(s) failed` : null;
    syncInFlight = false;
    log.info(`sync: fetched=${fetched} failed=${failed} total=${cfg.symbols.length} stale=${isStale()}`);
    return {
      ok: lastSyncOk,
      fetched,
      failed,
      total: cfg.symbols.length,
      skipped: false,
      stale: isStale(),
    };
  }

  /**
   * stale เมื่อ cache ทั้งหมดเก่ากว่า staleAfterSeconds นับจาก lastSyncAt
   * หรือไม่เคย sync สำเร็จ
   */
  function isStale() {
    if (!lastSyncAt) return true;
    if (!lastSyncOk) return true;
    const ageMs = cfg.now() - new Date(lastSyncAt).getTime();
    return ageMs > cfg.staleAfterSeconds * 1000;
  }

  /**
   * อ่าน quotes ทั้งหมดจาก cache (พร้อม envelope)
   * - ถ้า cache หมดอายุ (age > cacheSeconds) → trigger sync ใหม่ก่อน (await)
   * - ถ้า source ล้มเหลว → คืน cache เดิม + stale=true
   *
   * @param {object} [q] { symbols?: string[], assetClass?: string }
   * @returns {Promise<{ items: object[], updatedAt: string|null, stale: boolean, source: string }>}
   */
  async function readQuotes(q = {}) {
    const want = q.symbols && q.symbols.length ? q.symbols : cfg.symbols;

    // cache หมดอายุ → sync (await ครั้งแรก; ครั้งต่อๆ ไป syncInFlight กันซ้อน)
    if (cacheExpired() && !syncInFlight) {
      await sync().catch((err) => log.error(`readQuotes sync failed: ${err.message}`));
    }

    const items = [];
    for (const sym of want) {
      const entry = cache.get(sym);
      const histArr = history.get(sym) || [];
      if (!entry) {
        // ยังไม่เคย sync สำหรับ symbol นี้ → placeholder unavailable
        const assetClass = SYMBOL_ASSET_CLASS[sym] || "other";
        items.push({
          ...toPublicQuote({
            symbol: sym,
            assetClass,
            price: null,
            unavailable: true,
            unavailableReason: "not_synced",
            source: null,
            sourceUrl: null,
            fetchedAt: null,
          }, null, sym),
          history: histArr.slice(),
        });
        continue;
      }
      const quote = entry.quote;
      const change = computeChange(sym, quote);
      items.push({
        ...toPublicQuote({ ...quote, _stale: entry.stale === true }, change, sym),
        history: histArr.slice(),
      });
    }

    // filter ตาม assetClass (ถ้าระบุ)
    const filtered = q.assetClass && q.assetClass !== "all"
      ? items.filter((it) => it.assetClass === q.assetClass)
      : items;

    return {
      items: filtered,
      updatedAt: lastSyncAt,
      stale: isStale(),
      source: "aggregated", // backend รวมจากหลายแหล่ง
    };
  }

  /** cache หมดอายุ = lastSyncAt null หรือ age > cacheSeconds */
  function cacheExpired() {
    if (!lastSyncAt) return true;
    const ageMs = cfg.now() - new Date(lastSyncAt).getTime();
    return ageMs > cfg.cacheSeconds * 1000;
  }

  function getStatus() {
    return {
      enabled: cfg.enabled,
      syncInFlight,
      symbols: cfg.symbols,
      lastSyncAt,
      lastSyncOk,
      lastError,
      cachedSymbols: Array.from(cache.keys()),
      stale: isStale(),
    };
  }

  // เก็บ reference สำหรับ scheduler
  function _getConfig() { return cfg; }

  return {
    sync,
    readQuotes,
    isStale,
    getStatus,
    _getConfig,
    // expose สำหรับ test
    _cache: cache,
    _history: history,
  };
}

/**
 * แปลง internal quote → public quote (ตัด internal metadata)
 * field ตามที่ Codex กำหนด: symbol, price, change, percent, direction, updatedAt, stale, history[]
 */
export function toPublicQuote(quote, change, symbol) {
  const ch = change || { change: null, changePercent: null, direction: "flat" };
  const changePercent = round(ch.changePercent, 4);
  const stale = false; // stale ถูก set ที่ envelope level (ไม่ใช่ต่อ quote)
  return {
    symbol: quote.symbol || symbol,
    assetClass: quote.assetClass,
    price: quote.price ?? null,
    change: round(ch.change, 6),
    changePercent,
    percent: changePercent,
    direction: ch.direction,
    source: quote.source,
    sourceUrl: quote.sourceUrl,
    unavailable: !!quote.unavailable,
    unavailableReason: quote.unavailableReason || null,
    updatedAt: quote.fetchedAt,
    stale: stale || quote._stale === true,
    // history ถูก fill ที่ service (ด้านล่าง)
    history: [],
  };
}

function round(v, digits) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/**
 * สร้าง scheduler ที่ sync ทุก syncIntervalSeconds
 */
export function createMarketScheduler(service) {
  let timer = null;
  const intervalMs = Math.max(
    30,
    (service._getConfig().syncIntervalSeconds || 60) * 1000
  );

  function start() {
    if (timer) return false;
    timer = setInterval(() => {
      service.sync().catch((err) =>
        log.error(`scheduled market sync failed: ${err.message}`)
      );
    }, intervalMs);
    log.info(`market scheduler armed: every ${service._getConfig().syncIntervalSeconds}s`);
    return true;
  }
  function stop() {
    if (!timer) return false;
    clearInterval(timer);
    timer = null;
    return true;
  }
  function isRunning() { return timer !== null; }
  return { start, stop, isRunning };
}
