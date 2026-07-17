/* ============================================================
   Content Management UI Integration test (Phase 14 — Admin UI)
   ------------------------------------------------------------
   ทดสอบ flow จริง end-to-end:
     1. boot local server (content repos + upload service + autoPilot)
     2. login → รับ cookie HttpOnly (ห้ามมี token ใน frontend)
     3. jsdom render admin dashboard → ปุ่ม "จัดการเนื้อหาเว็บไซต์" ปรากฏ
     4. เปิด Content Manager (admin-content.js)
     5. GET /api/admin/content/counts ด้วย cookie → 200
     6. POST create draft EA → 201
     7. POST publish → 200 (publish gate)
     8. GET /api/content/ea (public) → เห็น item ที่ publish แล้ว
     9. ตรวจว่าระบบข่าว/Auto Pilot ยังทำงาน (regression)
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInContext } from "node:vm";
import { JSDOM } from "jsdom";

import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createContentRepositories } from "../src/store/contentRepository.js";
import { createUploadService } from "../src/content/uploadService.js";
import { createAutoPilotRepository } from "../src/store/autoPilotRepository.js";
import { createAuditRepository } from "../src/store/auditRepository.js";
import { createAutoPilot } from "../src/autopilot/autoPilot.js";
import { createHttpServer, listen } from "../src/api/server.js";

const projectRoot = resolve(process.cwd(), "..");
const V2 = resolve(projectRoot, "Version-2-Gold-Trading");
const read = (p) => readFileSync(resolve(V2, p), "utf8");

function makeTestToken() {
  return "test-" + randomBytes(16).toString("hex");
}

async function bootServer() {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const contentRepos = createContentRepositories(db);
  const tmpUploads = mkdtempSync(join(tmpdir(), "tt-content-ui-"));
  const uploadService = createUploadService({ uploadsRoot: tmpUploads });
  const apRepo = createAutoPilotRepository(db);
  const auditRepo = createAuditRepository(db);
  const autoPilot = createAutoPilot(
    { repo, apRepo, auditRepo },
    {
      fetchDigestFn: async () => ({ items: [], needsReview: [] }),
      fetchArticlesFn: async () => ({ results: [], errors: [] }),
      processBatchFn: async () => ({ results: [], saved: [], duplicates: [], failed: [] }),
      envAllowed: true,
    }
  );
  const token = makeTestToken();
  const server = createHttpServer({
    repo, contentRepos, uploadService, autoPilot, auditRepo,
    projectRoot, siteVersion: "2", adminToken: token, adminAllowedOrigins: [],
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  return {
    server,
    base: `http://127.0.0.1:${address.port}`,
    token,
    db,
    uploadsRoot: tmpUploads,
    close: async () => {
      await new Promise((r) => server.close(r));
      db.close();
      rmSync(tmpUploads, { recursive: true, force: true });
    },
  };
}

/** login → คืน cookie string */
async function login(base, token) {
  const res = await fetch(base + "/api/admin/auto-pilot/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ token }),
    redirect: "manual",
  });
  assert.equal(res.status, 200, "login ต้องสำเร็จ");
  const sc = res.headers.get("set-cookie");
  assert.match(sc, /admin_session=/i, "ต้องมี admin_session cookie");
  assert.match(sc, /httponly/i, "cookie ต้องเป็น HttpOnly (QC ข้อ 4: JS ใน browser อ่านไม่ได้)");
  // ดึงเฉพาะ cookie pair แรก (ตัด attributes)
  return sc.split(";")[0];
}

/** สร้าง jsdom ที่โหลด admin scripts ทั้งหมด + redirect fetch ไป server จริง */
async function makeAdminDom(base, cookie) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="app"></div></body></html>`, {
    url: base + "/Version-2-Gold-Trading/admin.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const W = dom.window;
  const ctx = dom.getInternalVMContext();

  // polyfills
  W.matchMedia = W.matchMedia || (() => ({
    matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  }));
  if (!W.IntersectionObserver) {
    W.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
  }

  // redirect fetch ไป server จริง + แนบ cookie เสมอ (จำลอง browser)
  W.fetch = async (url, init = {}) => {
    const fullUrl = url.startsWith("http") ? url : base + url;
    const headers = { ...(init.headers || {}) };
    headers.cookie = cookie; // แนบ session cookie
    return fetch(fullUrl, { ...init, headers, redirect: "manual" });
  };
  W.confirm = () => true; // auto-confirm deletes
  W.alert = () => {};

  const run = (code) => runInContext(code, ctx);

  run(read("data/site.js"));
  run(read("components/helpers.js"));
  run(read("components/icons.js"));
  // mock layout (admin ไม่ต้องการ navbar จริง)
  run(`
    window.TT = window.TT || {};
    TT.MarketTickerService = { subscribe(){}, start(){} };
    TT.layout = { page: ({ main }) => main, initNavbar(){} };
  `);
  run(read("admin.js"));
  run(read("admin-content.js"));

  // trigger DOMContentLoaded → render login
  W.document.dispatchEvent(new W.Event("DOMContentLoaded", { bubbles: true }));
  return W;
}

/** login ผ่าน API แล้ว → admin.js จะตรวจ session (cookie) เองใน checkSessionAndRender
    ดังนั้นไม่ต้องผ่าน form login — รอให้ dashboard render โดยตรง */
async function waitForDashboard(W, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const dashboard = W.document.querySelector(".admin-head");
    if (dashboard) return dashboard;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("dashboard ไม่ render ภายใน timeout (checkSessionAndRender อาจล้มเหลว)");
}

/** รอให้ state คงที่ */
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));

test("Content Management UI Integration — full flow", async () => {
  const s = await bootServer();
  let W = null;
  try {
    // ===== 1. login ผ่าน API → รับ cookie (HttpOnly) =====
    const cookie = await login(s.base, s.token);
    // cookie value คือ session token ของ backend (timing-safe compare) —
    // QC ข้อ 4 ตรวจ HttpOnly flag (JS อ่านไม่ได้) + frontend ไม่เก็บ token เอง
    // (ดูใน test ที่ 2 ว่า admin-content.js ไม่มี localStorage/Authorization)

    // ===== 2. ตรวจ /api/admin/content/counts ด้วย cookie =====
    const countsUnauth = await fetch(s.base + "/api/admin/content/counts");
    assert.equal(countsUnauth.status, 401, "counts ต้อง 401 ถ้าไม่มี cookie");
    const countsAuth = await fetch(s.base + "/api/admin/content/counts", {
      headers: { cookie },
    });
    assert.equal(countsAuth.status, 200, "counts ต้อง 200 ด้วย cookie");
    const countsBody = await countsAuth.json();
    assert.ok(countsBody.ea || countsBody.articles || countsBody.faq || countsBody.brokers,
      "counts ต้องมี key ของ content types");

    // ===== 3. jsdom render admin dashboard =====
    W = await makeAdminDom(s.base, cookie);
    // admin.js checkSessionAndRender → ตรวจ cookie → authenticated → dashboard
    // (cookie มีอยู่แล้วจาก login API จึงไม่ต้องผ่าน form login)
    const dashboard = await waitForDashboard(W);
    const initialActivity = W.document.getElementById("adminActivityPanel");
    assert.ok(initialActivity, "dashboard must render the operation status panel");
    assert.match(initialActivity.textContent, /สถานะการทำงาน/);

    const refreshNewsBtn = W.document.getElementById("adminRefreshNewsBtn");
    assert.ok(refreshNewsBtn, "refresh news button must exist");
    refreshNewsBtn.dispatchEvent(new W.Event("click", { bubbles: true }));
    assert.equal(refreshNewsBtn.disabled, true, "clicked action must disable while request is running");
    assert.match(W.document.getElementById("adminActivityPanel").textContent, /กำลังทำงาน/);
    await wait(350);
    const completedActivity = W.document.getElementById("adminActivityPanel");
    assert.match(completedActivity.textContent, /รีเฟรชสำเร็จ/);
    assert.ok(W.document.getElementById("adminRefreshNewsBtn")?.disabled === false, "button must be enabled after completion");

    // ดึงข่าวใหม่ต้องแสดงสถานะระหว่างทำงานและสรุปใหม่/ซ้ำ/รอตรวจ/ล้มเหลวเมื่อจบ
    const realAdminFetch = W.fetch;
    W.fetch = async (url, init = {}) => {
      if (String(url).endsWith("/api/admin/run")) {
        await wait(40);
        return new Response(JSON.stringify({
          digestItems: 9,
          opened: 6,
          saved: 2,
          existing: 3,
          duplicates: 1,
          needsReview: 1,
          failed: 0,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return realAdminFetch(url, init);
    };
    const fetchNewsBtn = W.document.getElementById("adminFetchBtn");
    fetchNewsBtn.dispatchEvent(new W.Event("click", { bubbles: true }));
    assert.equal(fetchNewsBtn.disabled, true, "fetch news button must disable while the pipeline is running");
    assert.match(W.document.getElementById("adminActivityPanel").textContent, /กำลังอ่านรายการต้นทาง/);
    await wait(200);
    const fetchResultText = W.document.getElementById("adminActivityPanel").textContent;
    assert.match(fetchResultText, /บันทึกใหม่ 2/);
    assert.match(fetchResultText, /ซ้ำกับระบบ 3/);
    assert.match(fetchResultText, /ซ้ำระหว่างประมวลผล 1/);
    assert.match(fetchResultText, /รอตรวจ 1/);
    assert.match(fetchResultText, /ล้มเหลว 0/);
    assert.ok(W.document.getElementById("adminFetchBtn")?.disabled === false, "fetch news button must re-enable after completion");
    W.fetch = realAdminFetch;
    assert.ok(dashboard, "dashboard ต้อง render หลัง login (cookie session ถูกตรวจสำเร็จ)");

    // ตรวจว่ามี section "จัดการเนื้อหาเว็บไซต์"
    const contentTitle = Array.from(W.document.querySelectorAll(".admin-section-title"))
      .find((el) => el.textContent.includes("จัดการเนื้อหาเว็บไซต์"));
    assert.ok(contentTitle, "ต้องมี section title 'จัดการเนื้อหาเว็บไซต์'");

    // ตรวจว่ามีปุ่ม "จัดการเนื้อหาเว็บไซต์"
    const contentBtn = W.document.getElementById("adminContentBtn");
    assert.ok(contentBtn, "ต้องมีปุ่ม adminContentBtn");
    assert.ok(!contentBtn.disabled, "ปุ่มต้องไม่ disabled (admin-content.js โหลดแล้ว)");
    assert.ok(contentBtn.textContent.includes("จัดการเนื้อหาเว็บไซต์"), "ปุ่มต้องมีข้อความที่ถูกต้อง");

    // ===== 4. คลิกปุ่ม → Content Manager เปิด =====
    contentBtn.dispatchEvent(new W.Event("click", { bubbles: true }));
    await wait(300); // รอ loadCounts + loadList async

    const managerRoot = W.document.getElementById("adminContentRoot");
    assert.ok(managerRoot, "Content Manager overlay ต้องเปิด (adminContentRoot)");
    assert.ok(managerRoot.querySelector(".admin-content"), "ต้องมี dialog .admin-content");

    // ตรวจว่ามี tab ครบทั้ง 4 (EA, Articles, FAQ, Brokers)
    const tabs = Array.from(managerRoot.querySelectorAll("[data-tab]")).map((b) => b.dataset.tab);
    assert.deepEqual(tabs.sort(), ["articles", "brokers", "ea", "faq"], "ต้องมี tab ครบ 4 types");

    // ตรวจว่า counts render เป็น stats (admin-stats)
    await wait(100);
    const stats = managerRoot.querySelector(".admin-stats");
    assert.ok(stats, "ต้องแสดง stats จาก counts API");

    // ===== 5. สร้าง draft EA ผ่าน API (CRUD flow) =====
    const createRes = await fetch(s.base + "/api/admin/content/ea", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: s.base },
      body: JSON.stringify({
        slug: "test-ea-integration",
        name: "Test EA Integration",
        description: "EA สำหรับทดสอบ integration",
        version: "1.0.0",
        platform: "mt5",
        price: 99,
        type: "paid",
        filePath: "ea-files/test-ea-integration.ex5",
        coverImage: "",
      }),
      redirect: "manual",
    });
    assert.equal(createRes.status, 201, "สร้าง EA draft ต้อง 201");
    const created = await createRes.json();
    assert.equal(created.status, "draft", "EA ใหม่ต้องเป็น draft");
    const eaId = created.id;
    assert.ok(eaId, "ต้องมี id ส่งกลับ");

    // ===== 6. publish EA (publish gate) =====
    const pubRes = await fetch(s.base + `/api/admin/content/ea/${eaId}/publish`, {
      method: "POST",
      headers: { cookie, origin: s.base },
      redirect: "manual",
    });
    assert.equal(pubRes.status, 200, "publish ต้องสำเร็จ (มี required fields ครบ)");
    const pubBody = await pubRes.json();
    assert.equal(pubBody.published, true, "ผล publish ต้องยืนยัน published=true");

    // ===== 7. public API ต้องเห็น EA ที่ publish แล้ว =====
    const publicRes = await fetch(s.base + "/api/content/ea");
    assert.equal(publicRes.status, 200, "public list ต้อง 200 (ไม่ต้อง auth)");
    const publicPage = await publicRes.json();
    assert.ok(Array.isArray(publicPage.items), "public list ต้องคืน items array");
    const found = publicPage.items.find((x) => x.id === eaId);
    assert.ok(found, "public API ต้องเห็น EA ที่ publish แล้ว");
    assert.equal(found.status, undefined, "public API ต้องไม่เปิดเผยสถานะภายใน");

    // ===== 8. ตรวจว่า draft ไม่ปรากฏใน public =====
    const draftRes = await fetch(s.base + "/api/admin/content/ea", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: s.base },
      body: JSON.stringify({
        slug: "test-ea-draft-only",
        name: "Test EA Draft Only",
        version: "1.0.0",
        platform: "mt5",
        price: 0,
        type: "free",
      }),
      redirect: "manual",
    });
    const draftItem = await draftRes.json();
    const publicPage2 = await (await fetch(s.base + "/api/content/ea")).json();
    assert.ok(!publicPage2.items.find((x) => x.id === draftItem.id), "draft ต้องไม่ปรากฏใน public API");

    // ===== 9. regression: ระบบข่าว/Auto Pilot ยังทำงาน =====
    const healthRes = await fetch(s.base + "/api/health");
    assert.equal(healthRes.status, 200, "health endpoint ต้องยังทำงาน");
    const newsRes = await fetch(s.base + "/api/news");
    assert.equal(newsRes.status, 200, "news API ต้องยังทำงาน");
    const apStatus = await fetch(s.base + "/api/admin/auto-pilot/status", { headers: { cookie } });
    assert.equal(apStatus.status, 200, "auto-pilot status ต้องยังทำงานด้วย cookie");

    // ===== 10. ปิด Content Manager → dispatch close event =====
    const closeBtn = W.document.getElementById("contentCloseBtn");
    assert.ok(closeBtn, "ต้องมีปุ่มปิด Content Manager");
    closeBtn.dispatchEvent(new W.Event("click", { bubbles: true }));
    await wait(100);
    assert.ok(!W.document.getElementById("adminContentRoot"), "Content Manager ต้องปิดแล้ว");
  } finally {
    W?.close();
    await s.close();
  }
});

test("Cookie auth required — ห้าม Bearer-only สำหรับ content API (QC ข้อ 6)", async () => {
  const s = await bootServer();
  try {
    // ใช้ Bearer token ตรงๆ → content endpoints ต้องผ่าน isAuthorizedAny (cookie OR bearer)
    // แต่ frontend ต้องไม่เก็บ/ส่ง Bearer — ตรวจว่า admin-content.js ไม่มีการเก็บ token
    const contentJs = read("admin-content.js");
    assert.ok(!contentJs.includes("localStorage"), "admin-content.js ห้ามใช้ localStorage (เก็บ token)");
    assert.ok(!contentJs.includes("Authorization"), "admin-content.js ห้ามส่ง Authorization header");
    assert.ok(contentJs.includes('credentials: "include"'), "admin-content.js ต้องใช้ credentials:include (cookie)");

    // ตรวจ admin.js ด้วย — ปุ่ม content ต้องไม่ส่ง token
    const adminJs = read("admin.js");
    assert.ok(!adminJs.match(/adminContent.*token/i), "admin.js ต้องไม่ส่ง token ให้ content module");
  } finally {
    await s.close();
  }
});
