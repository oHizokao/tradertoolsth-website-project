/* ============================================================
   TradingView widget — timeframe toolbar click regression
   ------------------------------------------------------------
   สาเหตุของบั๊กเดิม: คลิกบริเวณ toolbar ของกราฟ TradingView แล้ว
   เด้งไปหน้าอื่น (EA Hub) เพราะมีเลเยอร์โอเวอร์เลย์ (loader/error)
   หรือบริบทที่ "บัง/แย่ง pointer" อยู่เหนือ iframe

   regression test นี้พิสูจน์ว่า:
     1. โครงสร้าง DOM: host ของ iframe (#tv_chart_host) ไม่ได้อยู่
        ภายใน <a> ใด ๆ → คลิกในกรอบกราฟจะไม่ทริกเกอร์การนำทาง
     2. loader/error overlay เป็น "พี่น้อง" (sibling) ของ host ไม่ใช่
        บรรพบุรุษ — จึงไม่ห่อหุ้ม iframe
     3. คลิกภายในขอบเขต .tv-mount ไม่ทำให้เกิด navigation (location
        เดิม, ไม่มี <a href> ในเส้นทางเหตุการณ์)
     4. CSS: loader/error มี pointer-events:none (เหลือ retry กดได้),
        และไม่มี broad pointer-events:none บน .tv-mount / iframe /
        .tv-mount__frame (ซึ่งจะทำให้กราฟกดไม่ได้)

   ทดสอบทั้ง EURUSD และ DXY
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { runInContext } from "node:vm";
import { JSDOM } from "jsdom";

const projectRoot = resolve(process.cwd(), "..");
const V2 = resolve(projectRoot, "Version-2-Gold-Trading");
const read = (p) => readFileSync(resolve(V2, p), "utf8");
const CSS = read("styles/subpages-v2.css");

// mock SignalService ขั้นต่ำที่ signal.js ใช้ตอน render detail
function mockSignalService() {
  return `
    window.TT = window.TT || {};
    TT.SignalService = {
      eaConnected: false,
      source: "Market Ticker API",
      ASSET_FILTERS: [{ key: "all", label: "All" }],
      MOMENTUM_FILTERS: [{ key: "all", label: "All" }],
      subscribe: () => () => {},
      getSnapshot: () => ({ status: "init", signals: [], unavailable: [], total: 0 }),
      resolveSymbol: (raw) => {
        const key = String(raw == null ? "" : raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
        const META = {
          XAUUSD: "OANDA:XAUUSD", EURUSD: "FX:EURUSD", DXY: "TVC:DXY",
        };
        const tv = META[key] || "OANDA:XAUUSD";
        return { key, known: !!META[key], tv, label: key || "XAUUSD", assetClass: "forex", assetLabel: "Forex" };
      },
    };
    TT.layout = {
      ticker: () => '<div class="ticker-tape" id="marketTicker"></div>',
      page: ({ main }) => main,
      initNavbar: () => {},
    };
    TT.MarketTickerService = { subscribe() {}, start() {} };
  `;
}

async function renderDetail(symbol) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="app"></div></body></html>`, {
    url: `http://localhost/Version-2-Gold-Trading/signal.html?symbol=${encodeURIComponent(symbol)}`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const W = dom.window;
  const ctx = dom.getInternalVMContext();
  W.matchMedia = W.matchMedia || (() => ({
    matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  }));
  if (!W.MutationObserver) {
    // jsdom มี MutationObserver อยู่แล้ว — polyfill เผื่อ
  }
  const run = (code) => runInContext(code, ctx);
  run(read("data/site.js"));
  run(read("components/helpers.js"));
  run(read("components/icons.js"));
  run(mockSignalService());
  run(read("signal.js"));
  // trigger DOMContentLoaded → renderSymbolDetail(symbol)
  W.document.dispatchEvent(new W.Event("DOMContentLoaded", { bubbles: true }));
  return W;
}

for (const symbol of ["EURUSD", "DXY"]) {
  test(`[${symbol}] DOM: iframe host ไม่อยู่ภายใน <a> ใด ๆ`, async () => {
    const W = await renderDetail(symbol);
    const host = W.document.getElementById("tv_chart_host");
    assert.ok(host, "ต้องมี #tv_chart_host (chart container)");
    assert.equal(host.closest("a"), null, "host ต้องไม่อยู่ใน <a> (ไม่งั้นคลิกกราฟจะนำทาง)");
  });

  test(`[${symbol}] DOM: loader/error เป็น sibling ของ host (ไม่ห่อหุ้ม iframe)`, async () => {
    const W = await renderDetail(symbol);
    const host = W.document.getElementById("tv_chart_host");
    const mount = host.closest(".tv-mount");
    assert.ok(mount, "host ต้องอยู่ใน .tv-mount");
    const loader = mount.querySelector(".tv-mount__loader");
    const error = mount.querySelector(".tv-mount__error");
    assert.ok(loader, "ต้องมี loader overlay");
    assert.ok(error, "ต้องมี error overlay");
    // ทั้ง loader/error และ host ต้องเป็นลูกตรงของ mount ระดับเดียวกัน (sibling)
    assert.equal(loader.contains(host), false, "loader ต้องไม่บรรจุ host");
    assert.equal(error.contains(host), false, "error ต้องไม่บรรจุ host");
    assert.ok(host.parentElement === mount, "host ต้องเป็นลูกตรงของ mount");
  });

  test(`[${symbol}] click ในขอบเขต .tv-mount ไม่ก่อให้เกิด navigation`, async () => {
    const W = await renderDetail(symbol);
    const host = W.document.getElementById("tv_chart_host");
    const before = W.location.href;
    // จำลองคลิกซ้อนที่ host → ต้องไม่มี <a href> ในเส้นทาง และ location เดิม
    let navigated = false;
    const ev = new W.MouseEvent("click", { bubbles: true, cancelable: true });
    host.dispatchEvent(ev);
    // เดินขึ้นจาก target จนถึง .tv-mount ต้องไม่เจอ <a href>
    let node = ev.target;
    while (node && node !== W.document.body) {
      if (node.tagName === "A" && node.getAttribute("href")) {
        navigated = true;
        break;
      }
      node = node.parentElement;
    }
    assert.equal(navigated, false, "ต้องไม่มี <a href> ในเส้นทางคลิกของกราฟ");
    assert.equal(W.location.href, before, "location ต้องไม่เปลี่ยน");
  });
}

test("CSS: loader/error ปิด pointer-events; retry กดได้; ไม่ disable กราฟ", () => {
  // loader เป็นแค่สปินเนอร์ → pointer-events:none
  assert.match(CSS, /\.tv-mount__loader\s*\{[^}]*pointer-events:\s*none/i,
    "loader ต้อง pointer-events:none เพื่อไม่บังคลิกกราฟ");
  // error panel ก็ต้อง pointer-events:none (เหลือ retry กดได้อย่างเดียว)
  assert.match(CSS, /\.tv-mount__error\s*\{[^}]*pointer-events:\s*none/i,
    "error panel ต้อง pointer-events:none");
  assert.match(CSS, /\.tv-mount__retry\s*\{[^}]*pointer-events:\s*auto/i,
    "retry button ต้อง pointer-events:auto (ยังกดได้)");
  // ห้าม broad pointer-events:none บน .tv-mount เปล่า ๆ / iframe / __frame
  assert.doesNotMatch(CSS, /\.tv-mount\s*\{[^}]*pointer-events:\s*none/i,
    "ห้ามปิด pointer-events บน .tv-mount ทั้งตัว (กราฟจะกดไม่ได้)");
  assert.doesNotMatch(CSS, /\.tv-mount__frame[^,{]*,\s*[^}]*\.tv-mount iframe[^}]*pointer-events:\s*none/i,
    "ห้ามปิด pointer-events บน iframe/__frame");
  // state=ready ต้องซ่อนทั้ง loader และ error
  assert.match(CSS, /\[data-tv-state="ready"\]\s*\.tv-mount__loader[^{]*\{[^}]*display:\s*none/i,
    "ready ต้องซ่อน loader");
  assert.match(CSS, /\[data-tv-state="ready"\]\s*\.tv-mount__error[^{]*\{[^}]*display:\s*none/i,
    "ready ต้องซ่อน error ด้วย (กัน error ค้างบังกราฟที่โหลดแล้ว)");
});
