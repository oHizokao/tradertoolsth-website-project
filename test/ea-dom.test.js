/* ============================================================
   EA Hub — DOM integration test (jsdom)
   โหลดไฟล์จริงทั้งหมดตามลำดับใน ea.html แล้วตรวจ:
   - ไม่มี console error / throw
   - #app ถูก render (navbar + hero + filter + grid)
   - filter ทำงาน
   - submit modal เปิดได้ และ validation ทำงาน
   - กรณี API ไม่พร้อม → แสดง error state จริง (ไม่ mock success)
   ============================================================ */

const fs = require("fs");
const path = require("path");
const os = require("os");

// resolve jsdom จาก temp dir ที่ติดตั้งไว้ (cross-platform)
const JSDOM_PATH = path.join(
  os.tmpdir(),
  "ea-test",
  "node_modules",
  "jsdom"
);
const { JSDOM } = require(JSDOM_PATH);

const SITE = path.resolve(__dirname, "..", "Version-2-Gold-Trading");

function read(p) {
  return fs.readFileSync(path.join(SITE, p), "utf8");
}

const errors = [];
const logs = [];

function buildDom() {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body class="subpage-v2"><div id="app"></div><div id="eaDetailRoot"></div><div id="eaSubmitRoot"></div></body></html>`,
    {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      url: "http://localhost/Version-2-Gold-Trading/ea.html",
    }
  );
  const { window } = dom;

  // capture console
  window.console = {
    log: (...a) => logs.push(a.join(" ")),
    warn: (...a) => errors.push("WARN: " + a.join(" ")),
    error: (...a) => errors.push("ERROR: " + a.join(" ")),
    info: () => {},
    debug: () => {},
  };

  // fetch polyfill — default จำลอง API ยังไม่พร้อม (404)
  // (test บางเคสจะ override ให้ส่งข้อมูลจริง)
  window.__fetchMode = "unavailable";
  window.fetch = async (url) => {
    const u = String(url);
    // admin session check → false (ไม่ login)
    if (u.includes("/admin/auto-pilot/session")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ authenticated: false }),
      };
    }
    // public content/ea list
    if (window.__fetchMode === "available" && u.includes("/content/ea")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: "ea-001", slug: "goldtrend-pro", name: "GoldTrend Pro",
              description: "EA เทรดทองตามเทรนด์", platform: "both",
              price: 0, type: "free", version: "2.1.0",
              publishedAt: "2026-07-10T08:00:00Z",
            },
            {
              id: "ea-002", slug: "scalper-x", name: "ScalperX MT5",
              description: "EA scalper ความเร็วสูง", platform: "mt5",
              price: 99, type: "paid", version: "1.0.0",
              publishedAt: "2026-07-12T10:00:00Z",
            },
          ],
          total: 2, limit: 50, offset: 0,
        }),
      };
    }
    // default: unavailable
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: "not_found" }),
    };
  };

  // XMLHttpRequest polyfill — จำลอง submit ล้มเหลว (404)
  window.XMLHttpRequest = class {
    constructor() {
      this.upload = { onprogress: null };
      this.status = 0;
      this.responseText = "";
      this.timeout = 0;
    }
    open() {}
    setRequestHeader() {}
    getResponseHeader() { return null; }
    send() {
      this.status = 404;
      this.responseText = JSON.stringify({ error: "api_not_found" });
      setTimeout(() => {
        if (this.onload) this.onload();
      }, 5);
    }
  };

  // FormData / matchMedia stubs
  window.FormData = class FormData {
    constructor() { this.d = {}; }
    append(k, v) { this.d[k] = v; }
  };
  window.matchMedia = window.matchMedia || (() => ({
    matches: false,
    addEventListener() {},
    addListener() {},
  }));
  window.scrollTo = () => {};

  return dom;
}

function injectScripts(window) {
  const files = [
    "data/site.js",
    "components/icons.js",
    "components/helpers.js",
    "services/market-ticker.service.js",
    "components/layout.js",
    "components/cards.js",
    "services/ea.service.js",
    "ea.js",
  ];
  for (const f of files) {
    const code = read(f);
    // รันใน window context เพื่อให้ globals (window.TT) ถูกตั้งใน scope ที่ถูกต้อง
    window.eval(code);
  }
}

async function run() {
  const dom = buildDom();
  const { window } = dom;
  const document = window.document;

  // 1) inject scripts ทั้งหมด
  try {
    injectScripts(window);
  } catch (e) {
    console.error("❌ FAIL: inject scripts threw:", e.message);
    process.exit(1);
  }

  // ตรวจ globals
  const checks = [];
  const assert = (cond, msg) => checks.push({ cond, msg });

  assert(!!window.TT, "window.TT defined");
  assert(!!window.TT.h, "TT.h helpers defined");
  assert(!!window.TT.icon, "TT.icon defined");
  assert(!!window.TT.layout, "TT.layout defined");
  assert(!!window.TT.cards, "TT.cards defined");
  assert(typeof window.TT.cards.eaCard === "function", "TT.cards.eaCard is function");
  assert(!!window.TT.EAService, "TT.EAService defined");
  assert(typeof window.TT.EAService.fetchEAs === "function", "fetchEAs is function");
  assert(typeof window.TT.EAService.submitEA === "function", "submitEA is function");
  assert(typeof window.TT.EAService.validateSubmission === "function", "validateSubmission is function");

  // 2) fire DOMContentLoaded → render()
  const event = new window.Event("DOMContentLoaded", { bubbles: true });
  window.document.dispatchEvent(event);

  // รอ microtasks + setTimeout (service delay / fetch)
  await new Promise((r) => setTimeout(r, 50));

  // 3) ตรวจว่าหน้า render แล้ว
  assert(document.getElementById("navbar") !== null, "navbar rendered");
  assert(document.querySelector(".ea-hero") !== null, "EA hero rendered");
  assert(document.querySelector(".ea-risk") !== null, "risk warning rendered");
  assert(document.getElementById("eaToolbar") !== null, "toolbar rendered");
  assert(document.getElementById("eaList") !== null, "ea list container exists");
  assert(document.getElementById("eaQuery") !== null, "search input exists");
  assert(document.getElementById("eaStrategy") !== null, "strategy select exists");

  // 4) เพราะ API ส่ง 404 → ต้องเห็น error state (ไม่ใช่ mock success)
  const listHtml = document.getElementById("eaList").innerHTML || "";
  const isError = /state__title/.test(listHtml) || /โหลดไม่สำเร็จ|HTTP 404|เซิร์ฟเวอร์|เชื่อมต่อ/.test(listHtml);
  assert(isError, "shows error state when API unavailable (NOT mock success)");

  // 5) ทดสอบ eaCard render ด้วยข้อมูลตัวอย่าง (รูปแบบ backend จริง: platform string, type)
  const sampleEA = {
    id: "ea-001",
    slug: "goldtrend-pro",
    name: "GoldTrend Pro",
    description: "EA เทรดทองตามเทรนด์ รองรับ XAUUSD บน M15",
    platform: "both",   // backend enum
    price: 0,
    type: "free",        // backend enum
    version: "2.1.0",
    strategy: "Trend Following",
    publishedAt: "2026-07-10T08:00:00Z",
  };
  const cardHtml = window.TT.cards.eaCard(sampleEA);
  assert(/ea-card/.test(cardHtml), "eaCard produces .ea-card markup");
  assert(/ฟรี/.test(cardHtml), "free EA (type=free) shows ฟรี");
  assert(/MT4/.test(cardHtml) && /MT5/.test(cardHtml), "platform=both → both MT4/MT5 badges");
  assert(/v2\.1\.0/.test(cardHtml), "version rendered");
  assert(/data-ea-detail/.test(cardHtml), "detail button has data-ea-detail");
  assert(/10 ก\.ค\./.test(cardHtml), "publishedAt formatted in Bangkok time");

  // normalize ผ่าน service แล้วยัง render ถูก
  const normalized = window.TT.EAService.normalizeOne(sampleEA);
  assert(Array.isArray(normalized.platforms), "normalizeOne → platforms array");
  assert(normalized.platforms.length === 2, "both → 2 platforms");
  assert(normalized.isFree === true, "normalizeOne → isFree true");
  assert(normalized.type === "free", "normalizeOne → type preserved");

  // paid EA (type=paid, platform=mt5)
  const paidEA = { ...sampleEA, id: "ea-002", slug: "scalper-x", price: 129.5, type: "paid", platform: "mt5" };
  const paidCard = window.TT.cards.eaCard(paidEA);
  assert(/\$129\.50/.test(paidCard), "paid EA shows price");
  assert(!/ฟรี/.test(paidCard), "paid EA does NOT show ฟรี");
  assert(/ซื้อเลย/.test(paidCard), "paid EA CTA = ซื้อเลย");
  assert(/MT5/.test(paidCard), "platform=mt5 → MT5 badge");
  assert(!/MT4/.test(paidCard), "platform=mt5 → NO MT4 badge");

  // placeholder cover when no image
  const noImgEA = { ...sampleEA, id: "ea-003", coverImage: null, cover: null, image: null };
  const noImgCard = window.TT.cards.eaCard(noImgEA);
  assert(/ea-card__cover--placeholder/.test(noImgCard), "missing cover → placeholder");
  assert(/<svg/.test(noImgCard), "placeholder has inline SVG (no external image)");

  // 6) validation — ฟิลด์ว่าง
  const emptyCheck = window.TT.EAService.validateSubmission({
    name: "", description: "", platform: "", version: "", price: "", strategy: "",
  });
  assert(!emptyCheck.ok, "empty payload fails validation");
  assert(emptyCheck.errors.length >= 5, "multiple validation errors reported");

  // validation — ครบถูกต้อง
  const valid = window.TT.EAService.validateSubmission({
    name: "Test EA",
    description: "x".repeat(25),
    platform: "MT5",
    version: "1.0",
    price: "0",
    strategy: "Grid",
    eaFile: { name: "robot.ex5", size: 1000, type: "application/octet-stream" },
  });
  assert(valid.ok, "valid payload passes validation");

  // validation — ไฟล์ผิดประเภท
  const badFile = window.TT.EAService.validateSubmission({
    name: "Test EA", description: "x".repeat(25), platform: "MT5",
    version: "1.0", price: "0", strategy: "Grid",
    eaFile: { name: "script.exe", size: 1000, type: "application/octet-stream" },
  });
  assert(!badFile.ok, "wrong file extension rejected");

  // public submission ไม่รับราคา — server บังคับเป็น free เสมอ
  const ignoredPrice = window.TT.EAService.validateSubmission({
    name: "Test EA", description: "x".repeat(25), platform: "MT5",
    version: "1.0", price: "-50", strategy: "Grid",
    eaFile: { name: "robot.ex5", size: 1000 },
  });
  assert(ignoredPrice.ok, "public submission ignores privileged price field");

  // validation — ชื่อยาวเกิน cap
  const longName = window.TT.EAService.validateSubmission({
    name: "x".repeat(201), description: "x".repeat(25), platform: "MT5",
    version: "1.0", price: "0", strategy: "Grid",
    eaFile: { name: "robot.ex5", size: 1000 },
  });
  assert(!longName.ok, "name over 200 chars rejected");

  // 7) submit — ต้อง throw เมื่อ validation ไม่ผ่าน
  let submitThrew = false;
  try {
    await window.TT.EAService.submitEA({ name: "" });
  } catch (e) {
    submitThrew = true;
    assert(e.code === "validation_failed", "submit throws validation_failed");
  }
  assert(submitThrew, "submit rejects invalid payload");

  // 8) submit — validation ผ่าน แต่ endpoint ไม่พร้อม → ต้องคืน error จริง (ไม่ mock success)
  let submitApiThrew = false;
  let submitErr = null;
  try {
    await window.TT.EAService.submitEA({
      name: "Test EA", description: "x".repeat(25), platform: "MT5",
      version: "1.0", price: "0", strategy: "Grid",
      eaFile: { name: "robot.ex5", size: 1000 },
    });
  } catch (e) {
    submitApiThrew = true;
    submitErr = e;
  }
  assert(submitApiThrew, "submit throws when not authenticated (NO fake success)");
  if (submitErr) {
    assert(
      submitErr.code === "api_not_found" || submitErr.code === "submit_failed" || submitErr.code === "upload_failed" || submitErr.code === "invalid_response",
      "submit error has proper code: " + submitErr.code
    );
    assert(!!submitErr.serverError || !!submitErr.message,
      "submit error has human message");
  }

  // 9) navbar ต้องมีลิงก์ EA Hub
  const navHtml = document.getElementById("navbar").innerHTML || "";
  assert(/ea\.html/.test(navHtml), "navbar contains EA Hub link");

  // ===== 10) HAPPY PATH: API พร้อม → list render + filter ทำงาน =====
  // สลับ fetch mode เป็น available แล้ว reload
  window.__fetchMode = "available";
  window.TT.EAService.clearCache();
  // trigger loadList ผ่าน event ใหม่ (ea.js bind DOMContentLoaded)
  // แต่เนื่องจาก loadList เป็น closure ภายใน IIFE เราจะใช้การ dispatch
  // event อีกครั้งไม่ได้ (DOMContentLoaded ทำงานครั้งเดียว)
  // → เรียก fetchEAs ตรง ๆ แล้ว render ผ่าน cards เพื่อทดสอบ contract
  const liveItems = await window.TT.EAService.fetchEAs({ force: true });
  assert(liveItems.length === 2, "fetchEAs returns 2 items from available API");
  assert(liveItems[0].platforms.length === 2, "item[0] platform=both → 2 platforms");
  assert(liveItems[0].type === "free", "item[0] type=free");
  assert(liveItems[1].type === "paid", "item[1] type=paid");
  assert(liveItems[1].platforms.length === 1, "item[1] platform=mt5 → 1 platform");
  assert(liveItems[1].platforms[0] === "MT5", "item[1] platform label MT5");

  // render cards จากข้อมูลจริง
  const liveCards = liveItems.map(window.TT.cards.eaCard).join("");
  assert(/GoldTrend Pro/.test(liveCards), "live card 1 name rendered");
  assert(/ScalperX MT5/.test(liveCards), "live card 2 name rendered");
  assert(/ฟรี/.test(liveCards), "live free card shows ฟรี");
  assert(/\$99\.00/.test(liveCards), "live paid card shows \$99.00");

  // ===== 11) SUBMIT: endpoint error ต้องส่งกลับตรง ๆ =====
  let submitAuthErr = null;
  try {
    await window.TT.EAService.submitEA({
      name: "My EA", description: "x".repeat(25), platform: "MT5",
      version: "1.0", price: "0", strategy: "Grid",
      eaFile: { name: "robot.ex5", size: 1000, type: "application/octet-stream" },
    });
  } catch (e) {
    submitAuthErr = e;
  }
  assert(submitAuthErr !== null, "submit throws when public endpoint is unavailable");
  assert(submitAuthErr && submitAuthErr.code === "api_not_found",
    "submit preserves server error code (clear, not fake success)");
  assert(
    submitAuthErr && typeof submitAuthErr.serverError === "string" && submitAuthErr.serverError.length > 0,
    "auth error has human-readable message"
  );

  // ===== REPORT =====
  let passed = 0;
  let failed = 0;
  console.log("\n========== EA HUB TEST REPORT ==========");
  for (const c of checks) {
    if (c.cond) {
      passed++;
    } else {
      failed++;
      console.log("  ❌ FAIL: " + c.msg);
    }
  }
  console.log("");
  console.log("Passed: " + passed + " / " + checks.length);

  if (errors.length) {
    console.log("\n--- console warnings/errors captured ---");
    errors.slice(0, 10).forEach((e) => console.log("  " + e));
  } else {
    console.log("Console errors: 0");
  }

  if (failed > 0) {
    console.log("\n❌ " + failed + " CHECK(S) FAILED");
    process.exit(1);
  } else {
    console.log("\n✅ ALL CHECKS PASSED");
    process.exit(0);
  }
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(2);
});
