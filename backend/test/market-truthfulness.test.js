/* ============================================================
   Market Live — truthfulness regression (jsdom)
   ------------------------------------------------------------
   พิสูจน์ว่าหน้า Market:
     1. ระบุชัดเจนว่าเป็น "ข้อมูลราคาอ้างอิง" มิใช่สัญญาณเทรดจาก EA/MT5
     2. ไม่ผลิต Buy/Sell/Entry/SL/TP สัญญาณจำลองขึ้นมาเอง
     3. แสดงสถานะต่อสัญลักษณ์ (แหล่งข้อมูล + เวลา + stale) อย่างซื่อสัตย์
     4. เมื่อดึงข้อมูลไม่ได้ (unavailable) แสดงข้อความตรงตัว
        ไม่ใช่ "ยังไม่มีสินทรัพย์ในหมวดนี้" ซึ่งจะทำให้เข้าใจผิด
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInContext } from "node:vm";
import { JSDOM } from "jsdom";

const projectRoot = resolve(process.cwd(), "..");
const V2 = resolve(projectRoot, "Version-2-Gold-Trading");
const read = (p) => readFileSync(resolve(V2, p), "utf8");

function setupDom() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/Version-2-Gold-Trading/market.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const W = dom.window;
  const ctx = dom.getInternalVMContext();
  const run = (code) => runInContext(code, ctx);

  W.matchMedia = W.matchMedia || (() => ({
    matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  }));
  // polyfill fetch สำหรับ loadExtras() → คืน empty envelope ไม่ยิงจริง
  W.fetch = async () => ({
    ok: true,
    json: async () => ({ items: [] }),
  });

  run(read("data/site.js"));
  run(read("components/helpers.js"));
  run(read("components/icons.js"));

  // mock layout + MarketTickerService; เก็บ subscriber ไว้เรียกใน test
  let subscriber = null;
  run(`
    window.TT = window.TT || {};
    TT.layout = {
      ticker: () => '<div class="ticker-tape" id="marketTicker"></div>',
      page: ({ main }) => main,
      initNavbar: () => {},
    };
    TT.__marketSub = null;
    TT.MarketTickerService = {
      subscribe(fn) { TT.__marketSub = fn; return () => {}; },
      start() {},
      refresh() {},
    };
  `);
  run(read("market.js"));
  W.document.dispatchEvent(new W.Event("DOMContentLoaded", { bubbles: true }));
  return { W, getSub: () => W.TT.__marketSub };
}

const sampleItems = [
  {
    symbol: "XAUUSD", label: "Gold", price: 2350.42, change: 6.3,
    changePercent: 0.27, direction: "up", assetClass: "metals",
    source: "Market Ticker API", updatedAt: "2026-07-19T08:00:00.000Z",
    stale: false, history: [2340, 2345, 2350.42],
  },
  {
    symbol: "EURUSD", label: "Euro", price: 1.0892, change: -0.0021,
    changePercent: -0.19, direction: "down", assetClass: "forex",
    source: "Market Ticker API", updatedAt: "2026-07-19T08:00:00.000Z",
    stale: true, history: [1.091, 1.09, 1.0892],
  },
];

test("Market: มีป้าย 'ข้อมูลราคาอ้างอิง' และระบุว่ามิใช่สัญญาณ EA/MT5", async () => {
  const { W, getSub } = setupDom();
  getSub()({ status: "live", items: sampleItems, updatedAt: "2026-07-19T08:00:00.000Z", stale: false });
  const text = W.document.getElementById("app").textContent;
  assert.match(text, /ข้อมูลราคาอ้างอิง/i, "ต้องระบุชัดว่าเป็นข้อมูลอ้างอิง");
  assert.match(text, /EA\/MT5/i, "ต้องอ้างถึง EA/MT5 ว่ายังไม่ได้เชื่อมต่อเป็น signal feed");
});

test("Market: ไม่ผลิตสัญญาณซื้อขายจำลอง (Buy/Sell/Entry/SL/TP)", async () => {
  const { W, getSub } = setupDom();
  getSub()({ status: "live", items: sampleItems, updatedAt: "2026-07-19T08:00:00.000Z", stale: false });
  const text = W.document.getElementById("app").textContent;
  for (const tok of ["Entry", "Take Profit", "Stop Loss", "BUY", "SELL"]) {
    assert.equal(text.includes(tok), false, `ต้องไม่มีสัญญาณจำลอง "${tok}"`);
  }
});

test("Market: แสดงสถานะต่อสัญลักษณ์ (แหล่งข้อมูล + stale badge)", async () => {
  const { W, getSub } = setupDom();
  getSub()({ status: "live", items: sampleItems, updatedAt: "2026-07-19T08:00:00.000Z", stale: false });
  const app = W.document.getElementById("app");
  const srcs = app.querySelectorAll(".market-card__src");
  assert.ok(srcs.length >= 2, "การ์ดต้องมี meta source ต่อสัญลักษณ์");
  // การ์ด EURUSD ที่ stale=true ต้องมี stale badge
  const eurCard = [...app.querySelectorAll(".market-card")].find((c) =>
    c.querySelector("[data-symbol='EURUSD']"));
  assert.ok(eurCard, "ต้องมีการ์ด EURUSD");
  assert.ok(eurCard.querySelector(".market-card__stale"), "การ์ด stale ต้องมี stale badge");
});

test("Market: unavailable → ข้อความตรงตัว ไม่ใช่ 'ไม่มีสินทรัพย์ในหมวด'", async () => {
  const { W, getSub } = setupDom();
  getSub()({ status: "unavailable", items: [], updatedAt: null, stale: false });
  const grid = W.document.getElementById("marketGrid");
  const text = grid.textContent;
  assert.match(text, /ไม่สามารถอัปเดตข้อมูลตลาด/i, "ต้องแจ้งว่าดึงข้อมูลไม่ได้");
  assert.equal(text.includes("ยังไม่มีสินทรัพย์ในหมวดนี้"), false,
    "ห้ามแสดงเป็น 'ไม่มีสินทรัพย์' เพราะจะเข้าใจผิด");
});
