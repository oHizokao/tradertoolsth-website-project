/* ============================================================
   Phase 13 — Market Ticker API + Calendar API tests
   ------------------------------------------------------------
   ครอบคลุม:
   - market: success, filter (symbols/assetClass), DXY unavailable,
     timeout→stale fallback, empty (no symbols synced), invalid query
   - market rate-limit/cache: consecutive reads ไม่ re-fetch ภายใน cacheSeconds
   - calendar: success envelope, invalid impact → 400, currency filter

   ใช้ in-memory test DB + injectable marketService.fetchFn (ไม่ยิง network จริง)
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createCalendarRepository } from "../src/store/calendarRepository.js";
import { createCalendarService } from "../src/calendar/calendarService.js";
import { createMarketService, DEFAULT_SYMBOLS } from "../src/market/marketService.js";
import { createHttpServer, listen } from "../src/api/server.js";
import { resolve } from "node:path";

const projectRoot = resolve(process.cwd(), "..");

/* ---------- helpers ---------- */
async function makeServer({ marketService, calendarService }) {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const server = createHttpServer({
    repo,
    marketService,
    calendarService,
    projectRoot,
    siteVersion: "2",
    adminToken: "",
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  return {
    server,
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}

/** injectable fetchFn สำหรับ marketService (mock) */
function mockFetchFn(symbolToQuote) {
  const calls = [];
  return {
    calls,
    fn: async (symbol) => {
      calls.push(symbol);
      const q = symbolToQuote[symbol];
      if (!q) throw new Error(`mock: no quote for ${symbol}`);
      return q;
    },
  };
}

/* ---------- 1) market success + envelope shape ---------- */
test("market-ticker returns envelope with all symbols", async () => {
  const quotes = {
    XAUUSD: { price: 2415.30, source: "gold-api.com", sourceUrl: "https://gold-api.com", fetchedAt: "2026-07-16T05:00:00.000Z" },
    XAGUSD: { price: 30.45, source: "gold-api.com", sourceUrl: "https://gold-api.com", fetchedAt: "2026-07-16T05:00:00.000Z" },
    EURUSD: { price: 0.8734, source: "open.er-api.com", sourceUrl: "https://www.exchangerate-api.com", fetchedAt: "2026-07-16T05:00:00.000Z" },
    GBPUSD: { price: 0.7422, source: "open.er-api.com", sourceUrl: "https://www.exchangerate-api.com", fetchedAt: "2026-07-16T05:00:00.000Z" },
    USDJPY: { price: 162.15, source: "open.er-api.com", sourceUrl: "https://www.exchangerate-api.com", fetchedAt: "2026-07-16T05:00:00.000Z" },
    BTCUSD: { price: 64536, source: "CoinGecko", sourceUrl: "https://www.coingecko.com", fetchedAt: "2026-07-16T05:00:00.000Z" },
    DXY: { price: 100.5, change: -0.78, changePercent: -0.77, source: "Yahoo Finance", sourceUrl: "https://finance.yahoo.com", fetchedAt: "2026-07-16T05:00:00.000Z" },
    OIL: { price: 79.26, change: 1.12, changePercent: 1.43, source: "Yahoo Finance", sourceUrl: "https://finance.yahoo.com", fetchedAt: "2026-07-16T05:00:00.000Z" },
    // DXY ไม่มี mock → unavailable
  };
  const { calls, fn } = mockFetchFn(quotes);
  const marketService = createMarketService({
    symbols: DEFAULT_SYMBOLS,
    fetchFn: fn,
    cacheSeconds: 60,
    staleAfterSeconds: 600,
  });
  const { server, base, close } = await makeServer({ marketService });

  const res = await fetch(`${base}/api/market-ticker`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(Array.isArray(body.items), true);
  assert.equal(body.items.length, 8);
  assert.equal(body.stale, false);
  assert.equal(body.source, "aggregated");
  assert.equal(typeof body.updatedAt, "string");

  // DXY และ OIL ต้องมาจาก source จริง ไม่ใช่ placeholder
  const dxy = body.items.find((i) => i.symbol === "DXY");
  assert.equal(dxy.unavailable, false);
  assert.equal(dxy.price, 100.5);
  assert.equal(dxy.changePercent, -0.77);
  const oil = body.items.find((i) => i.symbol === "OIL");
  assert.equal(oil.unavailable, false);
  assert.equal(oil.price, 79.26);

  // XAUUSD ต้องมีราคาจริงจาก mock
  const xau = body.items.find((i) => i.symbol === "XAUUSD");
  assert.equal(xau.price, 2415.30);
  assert.equal(xau.source, "gold-api.com");
  assert.equal(xau.unavailable, false);
  assert.equal(["up", "down", "flat"].includes(xau.direction), true);

  // ทุก quote ต้องมี field ครบตาม contract
  for (const it of body.items) {
    assert.equal(typeof it.symbol, "string");
    assert.equal(typeof it.assetClass, "string");
    assert.equal(Array.isArray(it.history), true);
    assert.equal(["up", "down", "flat"].includes(it.direction), true);
  }

  await close();
});

/* ---------- 2) no secret leak ---------- */
test("market-ticker response does not expose secrets", async () => {
  const { fn } = mockFetchFn({
    XAUUSD: { price: 1, source: "s", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" },
  });
  const marketService = createMarketService({
    symbols: ["XAUUSD"], fetchFn: fn, cacheSeconds: 60, staleAfterSeconds: 600,
  });
  const { server, base, close } = await makeServer({ marketService });
  const body = await fetch(`${base}/api/market-ticker`).then((r) => r.json());
  for (const it of body.items) {
    for (const key of ["apiKey", "api_key", "secret", "token", "adminToken", "password"]) {
      assert.equal(it[key], undefined, `field ${key} must not leak`);
    }
  }
  await close();
});

/* ---------- 3) symbols filter ---------- */
test("market-ticker symbols filter returns only requested", async () => {
  const { fn } = mockFetchFn({
    XAUUSD: { price: 2400, source: "s", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" },
    EURUSD: { price: 0.87, source: "s", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" },
  });
  const marketService = createMarketService({
    symbols: ["XAUUSD", "EURUSD", "USDJPY"], fetchFn: fn, cacheSeconds: 60, staleAfterSeconds: 600,
  });
  const { server, base, close } = await makeServer({ marketService });
  const body = await fetch(`${base}/api/market-ticker?symbols=XAUUSD,EURUSD`).then((r) => r.json());
  assert.equal(body.items.length, 2);
  assert.equal(body.items.every((i) => ["XAUUSD", "EURUSD"].includes(i.symbol)), true);
  await close();
});

/* ---------- 4) symbols filter ignores invalid (whitelist) ---------- */
test("market-ticker ignores invalid symbol names (whitelist)", async () => {
  const { fn } = mockFetchFn({
    XAUUSD: { price: 1, source: "s", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" },
  });
  const marketService = createMarketService({
    symbols: ["XAUUSD"], fetchFn: fn, cacheSeconds: 60, staleAfterSeconds: 600,
  });
  const { server, base, close } = await makeServer({ marketService });
  // ลอง inject bogus + SQL-ish string (ต้องถูกกรอง)
  const body = await fetch(`${base}/api/market-ticker?symbols=XAUUSD,BOGUS%3BSELECT%2A`).then((r) => r.json());
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].symbol, "XAUUSD");
  await close();
});

/* ---------- 5) assetClass filter ---------- */
test("market-ticker assetClass filter works", async () => {
  const { fn } = mockFetchFn({
    XAUUSD: { price: 2400, source: "s", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" },
    XAGUSD: { price: 30, source: "s", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" },
    EURUSD: { price: 0.87, source: "s", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" },
  });
  const marketService = createMarketService({
    symbols: ["XAUUSD", "XAGUSD", "EURUSD"], fetchFn: fn, cacheSeconds: 60, staleAfterSeconds: 600,
  });
  const { server, base, close } = await makeServer({ marketService });
  const metals = await fetch(`${base}/api/market-ticker?assetClass=metals`).then((r) => r.json());
  assert.equal(metals.items.length, 2);
  assert.equal(metals.items.every((i) => i.assetClass === "metals"), true);

  const forex = await fetch(`${base}/api/market-ticker?assetClass=forex`).then((r) => r.json());
  assert.equal(forex.items.length, 1);
  assert.equal(forex.items[0].symbol, "EURUSD");
  await close();
});

/* ---------- 6) invalid assetClass → 400 ---------- */
test("market-ticker invalid assetClass returns 400", async () => {
  const marketService = createMarketService({ symbols: [], fetchFn: () => { throw new Error("x"); }, cacheSeconds: 60 });
  const { server, base, close } = await makeServer({ marketService });
  const res = await fetch(`${base}/api/market-ticker?assetClass=bogus`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "invalid_asset_class");
  assert.equal(Array.isArray(body.allowed), true);
  await close();
});

/* ---------- 7) timeout / source failure → stale fallback ---------- */
test("market-ticker source failure returns cache + stale=true", async () => {
  // sync ครั้งแรกสำเร็จ, ครั้งที่ 2 fail → cache ต้องยังอยู่ + stale
  let attempt = 0;
  const fetchFn = async (sym) => {
    attempt++;
    if (sym === "XAUUSD") {
      if (attempt > 1) throw new Error("source timeout");
      return { price: 2410, source: "gold-api.com", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" };
    }
    throw new Error("no mock");
  };
  // clock เลื่อนเวลาให้ cache หมดอายุ + stale
  let nowMs = Date.parse("2026-07-16T05:00:00Z");
  const marketService = createMarketService({
    symbols: ["XAUUSD"],
    fetchFn,
    cacheSeconds: 10,
    staleAfterSeconds: 30,
    now: () => nowMs,
  });
  const { server, base, close } = await makeServer({ marketService });

  // sync ครั้งแรก → สำเร็จ
  await marketService.sync();
  const r1 = await marketService.readQuotes();
  assert.equal(r1.stale, false);
  assert.equal(r1.items[0].price, 2410);

  // เลื่อนเวลาให้ cache หมดอายุ + เลย staleAfterSeconds
  nowMs += 60_000;
  // sync ครั้งที่ 2 → XAUUSD fail → cache ยังอยู่ + stale=true
  await marketService.sync();
  const r2 = await marketService.readQuotes();
  assert.equal(r2.stale, true);
  // cache ล่าสุดยังคืน (fallback)
  const xau2 = r2.items.find((i) => i.symbol === "XAUUSD");
  assert.equal(xau2.price, 2410);

  await close();
});

/* ---------- 8) empty response (no symbols synced) ---------- */
test("market-ticker empty when no symbols synced", async () => {
  const marketService = createMarketService({
    symbols: ["XAUUSD"], fetchFn: () => { throw new Error("always fail"); },
    cacheSeconds: 60, staleAfterSeconds: 600,
  });
  const { server, base, close } = await makeServer({ marketService });
  const body = await fetch(`${base}/api/market-ticker`).then((r) => r.json());
  // fetch fail ทั้งหมด → item unavailable (ไม่ใช่ empty array)
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].unavailable, true);
  assert.equal(body.items[0].price, null);
  await close();
});

/* ---------- 9) rate-limit / cache: consecutive reads ไม่ re-fetch ---------- */
test("market-ticker consecutive reads do not re-fetch within cache window", async () => {
  const { calls, fn } = mockFetchFn({
    XAUUSD: { price: 1, source: "s", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" },
  });
  let nowMs = Date.parse("2026-07-16T05:00:00Z");
  const marketService = createMarketService({
    symbols: ["XAUUSD"], fetchFn: fn, cacheSeconds: 60, staleAfterSeconds: 600, now: () => nowMs,
  });
  const { server, base, close } = await makeServer({ marketService });

  // read ครั้งที่ 1 → trigger sync
  await fetch(`${base}/api/market-ticker`).then((r) => r.json());
  const callsAfter1 = calls.length;
  assert.ok(callsAfter1 >= 1, "first read should fetch");

  // read ครั้งที่ 2,3 ทันที → ต้องไม่ re-fetch (cache ยังสด)
  await fetch(`${base}/api/market-ticker`).then((r) => r.json());
  await fetch(`${base}/api/market-ticker`).then((r) => r.json());
  assert.equal(calls.length, callsAfter1, "consecutive reads must hit cache, not source");

  await close();
});

/* ---------- 10) history accumulates across syncs ---------- */
test("market-ticker history accumulates across syncs", async () => {
  let price = 100;
  const { fn } = mockFetchFn({
    XAUUSD: { price, source: "s", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" },
  });
  // mock ที่เปลี่ยนราคาทุกครั้ง
  const dynamicFn = async (sym) => {
    price += 1;
    return { price, source: "s", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" };
  };
  let nowMs = Date.parse("2026-07-16T05:00:00Z");
  const marketService = createMarketService({
    symbols: ["XAUUSD"], fetchFn: dynamicFn, cacheSeconds: 1, staleAfterSeconds: 600, now: () => nowMs,
  });
  const { server, base, close } = await makeServer({ marketService });

  await marketService.sync();
  nowMs += 2000;
  await marketService.sync();
  nowMs += 2000;
  await marketService.sync();
  const body = await fetch(`${base}/api/market-ticker`).then((r) => r.json());
  const xau = body.items.find((i) => i.symbol === "XAUUSD");
  assert.ok(xau.history.length >= 2, "history should accumulate");
  assert.ok(xau.history.length <= 24, "history capped at 24");
  await close();
});

/* ---------- 11) status endpoint ---------- */
test("market-ticker status returns service state without secrets", async () => {
  const { fn } = mockFetchFn({
    XAUUSD: { price: 1, source: "s", sourceUrl: "u", fetchedAt: "2026-07-16T05:00:00.000Z" },
  });
  const marketService = createMarketService({ symbols: ["XAUUSD"], fetchFn: fn, cacheSeconds: 60 });
  const { server, base, close } = await makeServer({ marketService });
  await fetch(`${base}/api/market-ticker`).then((r) => r.json()); // warm cache
  const body = await fetch(`${base}/api/market-ticker/status`).then((r) => r.json());
  assert.equal(typeof body.enabled, "boolean");
  assert.equal(Array.isArray(body.symbols), true);
  for (const key of ["apiKey", "secret", "token", "adminToken"]) {
    assert.equal(body[key], undefined, `status must not leak ${key}`);
  }
  await close();
});

/* ---------- 12) calendar integration (sanity) ---------- */
test("calendar API returns envelope + filters by currency", async () => {
  const db = createTestDb();
  const calRepo = createCalendarRepository(db);
  const cal = createCalendarService(calRepo, {
    fetchFn: async () => [
      {
        sourceEventId: "ff-usd-1", sourceName: "FF", sourceUrl: "u",
        eventName: "CPI", country: "USD", currency: "USD", impact: "high",
        scheduledAtUtc: "2026-07-20T12:30:00.000Z", scheduledAtBangkok: "2026-07-20T19:30:00.000Z",
        actual: null, forecast: "3.2%", previous: "3.1%", revised: null,
        detailUrl: null, isTentative: false, lastUpdated: "2026-07-15T00:00:00.000Z",
      },
      {
        sourceEventId: "ff-eur-1", sourceName: "FF", sourceUrl: "u",
        eventName: "ECB Rate", country: "EUR", currency: "EUR", impact: "high",
        scheduledAtUtc: "2026-07-21T11:00:00.000Z", scheduledAtBangkok: "2026-07-21T18:00:00.000Z",
        actual: null, forecast: null, previous: null, revised: null,
        detailUrl: null, isTentative: false, lastUpdated: "2026-07-15T00:00:00.000Z",
      },
    ],
  });
  await cal.sync({ force: true });
  const marketService = createMarketService({ symbols: [], fetchFn: () => { throw new Error("x"); }, cacheSeconds: 60 });
  const { server, base, close } = await makeServer({ calendarService: cal, marketService });

  const all = await fetch(`${base}/api/calendar?from=2026-07-20&to=2026-07-22`).then((r) => r.json());
  assert.equal(all.items.length, 2);
  assert.equal(all.stale, false);
  // source มาจาก config (default "Forex Factory") ไม่ใช่ค่าใน mock event
  assert.equal(all.source, "Forex Factory");

  const usdOnly = await fetch(`${base}/api/calendar?currency=USD&from=2026-07-20&to=2026-07-22`).then((r) => r.json());
  assert.equal(usdOnly.items.length, 1);
  assert.equal(usdOnly.items[0].currency, "USD");
  // time UTC + Bangkok ทั้งคู่
  assert.equal(usdOnly.items[0].scheduledAtUtc, "2026-07-20T12:30:00.000Z");
  assert.equal(usdOnly.items[0].scheduledAtBangkok, "2026-07-20T19:30:00.000Z");

  await close();
});

/* ---------- 13) calendar invalid impact → 400 ---------- */
test("calendar API invalid impact returns 400", async () => {
  const db = createTestDb();
  const calRepo = createCalendarRepository(db);
  const cal = createCalendarService(calRepo, { fetchFn: async () => [] });
  const marketService = createMarketService({ symbols: [], fetchFn: () => { throw new Error("x"); }, cacheSeconds: 60 });
  const { server, base, close } = await makeServer({ calendarService: cal, marketService });
  const res = await fetch(`${base}/api/calendar?impact=bogus`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "invalid_importance");
  await close();
});
