/* ============================================================
   Admin — delete news + fetch-all controls (Phase 10+)
   ------------------------------------------------------------
   Backend:
     A. Auth rejected (DELETE single / bulk-delete / run with fetchAll)
     B. count/image/fetchAll semantics reach updater.run (effectiveMax)
     C. DELETE single: 404 missing, 200 existing (truthful)
     D. bulk-delete: selected exact IDs deleted
     E. bulk-delete: invalid/empty IDs → 400
     F. bulk-delete: missing IDs reported in notFoundIds (truthful)
        + dedupe of duplicate IDs

   Static frontend (admin.js source):
     G. fetchAll controls present
     H. selection + bulk delete selectors present
     I. no nav-theme-btn (dark mode removed)
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createHttpServer, listen } from "../src/api/server.js";

const projectRoot = resolve(process.cwd(), "..");
const FRONTEND_DIR = join(projectRoot, "Version-2-Gold-Trading");
const ADMIN_JS = readFileSync(join(FRONTEND_DIR, "admin.js"), "utf8");
const LAYOUT_JS = readFileSync(join(FRONTEND_DIR, "components", "layout.js"), "utf8");

function makeTestToken() {
  return "test-" + randomBytes(16).toString("hex");
}

/** สร้าง news object มินิมอลสำหรับ seed ฐานข้อมูล */
function makeNews(id, extra = {}) {
  return {
    id,
    source: "test-source",
    sourceUrl: `https://example.test/${id}`,
    originalTitle: `Original ${id}`,
    originalContent: "body",
    thaiTitle: `หัวข้อ ${id}`,
    thaiSummary: "สรุป",
    thaiContent: ["ย่อหน้า 1"],
    validationStatus: "fetched",
    publishStatus: "draft",
    duplicateHash: `hash-${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

async function makeServer() {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const token = makeTestToken();
  const server = createHttpServer({
    repo,
    // Login route belongs to the auto-pilot namespace; the deletion tests
    // only need that namespace enabled, not a running pipeline instance.
    autoPilot: {},
    projectRoot,
    adminToken: token,
    adminAllowedOrigins: [],
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  return {
    server,
    base: `http://127.0.0.1:${address.port}`,
    token,
    db,
    repo,
    close: async () => {
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}

async function login(base, token) {
  const res = await fetch(base + "/api/admin/auto-pilot/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ token }),
    redirect: "manual",
  });
  assert.equal(res.status, 200, "login ต้องสำเร็จ");
  return res.headers.get("set-cookie").split(";")[0];
}

async function call(method, url, cookie, body, { origin } = {}) {
  const init = {
    method,
    headers: { "content-type": "application/json" },
    redirect: "manual",
  };
  if (cookie) init.headers.cookie = cookie;
  if (origin) init.headers.origin = origin;
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { status: res.status, payload: payload || {} };
}

// ============ Backend tests ============

test("A. delete + run endpoints ไม่มี auth → 401", async () => {
  const s = await makeServer();
  try {
    const r1 = await call("DELETE", `${s.base}/api/admin/news/abc`, null, null, { origin: s.base });
    assert.equal(r1.status, 401);
    const r2 = await call("POST", `${s.base}/api/admin/news/bulk-delete`, null, { ids: ["a"] }, { origin: s.base });
    assert.equal(r2.status, 401);
    const r3 = await call("POST", `${s.base}/api/admin/run`, null, { fetchAll: true }, { origin: s.base });
    assert.equal(r3.status, 401);
  } finally {
    await s.close();
  }
});

test("B. fetchAll semantics reach updater (effectiveMax bounded)", async () => {
  const calls = [];
  // updater ที่จำ opts แล้วคืน report มาตรฐาน
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const token = makeTestToken();
  const updater = {
    run: async (opts) => {
      calls.push(opts);
      return { ok: true, digestItems: 0, opened: 0, saved: 0, existing: 0, duplicates: 0, needsReview: 0, failed: 0 };
    },
  };
  const server = createHttpServer({ repo, updater, autoPilot: {}, projectRoot, adminToken: token, adminAllowedOrigins: [] });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${address.port}`;
  const close = async () => { await new Promise((r) => server.close(r)); db.close(); };
  try {
    const cookie = await login(base, token);
    // fetchAll true → maxPerRun เป็น bounded constant (50) ไม่ใช่ 10/3 + fetchAll ผ่านถึง updater
    const r1 = await call("POST", `${base}/api/admin/run`, cookie, { fetchAll: true, maxPerRun: 999 }, { origin: base });
    assert.equal(r1.status, 200);
    assert.equal(calls[0].fetchAll, true);
    assert.equal(calls[0].autoPublish, false, "manual fetch ต้องไม่ auto-publish");
    assert.ok(calls[0].maxPerRun <= 50, "fetchAll ต้อง bound ไม่เกิน 50");
    assert.equal(r1.payload.fetchAll, true);
    assert.equal(r1.payload.effectiveMax, calls[0].maxPerRun);
    assert.equal(r1.payload.skipImage, false, "default withImages → skipImage:false");

    // fetchAll false → ใช้ maxPerRun clamp 1-10 ปกติ
    const r2 = await call("POST", `${base}/api/admin/run`, cookie, { fetchAll: false, maxPerRun: 7 }, { origin: base });
    assert.equal(r2.status, 200);
    assert.equal(calls[1].fetchAll, false);
    assert.equal(calls[1].maxPerRun, 7);

    // withImages:false → skipImage:true, fetchAll defaults false เมื่อไม่ส่ง
    const r3 = await call("POST", `${base}/api/admin/run`, cookie, { maxPerRun: 3, withImages: false }, { origin: base });
    assert.equal(r3.status, 200);
    assert.equal(calls[2].fetchAll, false);
    assert.equal(calls[2].skipImage, true);
  } finally {
    await close();
  }
});

test("C. DELETE single: 404 missing / 200 existing", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(makeNews("n1"));
    const cookie = await login(s.base, s.token);
    const missing = await call("DELETE", `${s.base}/api/admin/news/does-not-exist`, cookie, null, { origin: s.base });
    assert.equal(missing.status, 404);
    assert.equal(missing.payload.error, "news_not_found");
    const ok = await call("DELETE", `${s.base}/api/admin/news/n1`, cookie, null, { origin: s.base });
    assert.equal(ok.status, 200);
    assert.equal(ok.payload.deleted, true);
    assert.equal(s.repo.existsById("n1"), false, "row ต้องถูกลบจริง");
  } finally {
    await s.close();
  }
});

test("D. bulk-delete: selected exact IDs deleted", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(makeNews("a"));
    s.repo.insertNews(makeNews("b"));
    s.repo.insertNews(makeNews("c"));
    const cookie = await login(s.base, s.token);
    const r = await call("POST", `${s.base}/api/admin/news/bulk-delete`, cookie, { ids: ["a", "c"] }, { origin: s.base });
    assert.equal(r.status, 200);
    assert.deepEqual(r.payload.deletedIds.sort(), ["a", "c"]);
    assert.deepEqual(r.payload.notFoundIds, []);
    assert.equal(s.repo.existsById("a"), false);
    assert.equal(s.repo.existsById("c"), false);
    assert.equal(s.repo.existsById("b"), true, "b ไม่ถูกเลือก ต้องยังอยู่");
  } finally {
    await s.close();
  }
});

test("E. bulk-delete: invalid/empty/too-many IDs → 400", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(makeNews("a"));
    const cookie = await login(s.base, s.token);
    // ไม่ใช่ array
    const r1 = await call("POST", `${s.base}/api/admin/news/bulk-delete`, cookie, { ids: "a" }, { origin: s.base });
    assert.equal(r1.status, 400);
    // empty
    const r2 = await call("POST", `${s.base}/api/admin/news/bulk-delete`, cookie, { ids: [] }, { origin: s.base });
    assert.equal(r2.status, 400);
    // entry ไม่ valid (non-string)
    const r3 = await call("POST", `${s.base}/api/admin/news/bulk-delete`, cookie, { ids: [123] }, { origin: s.base });
    assert.equal(r3.status, 400);
    // entry empty string
    const r4 = await call("POST", `${s.base}/api/admin/news/bulk-delete`, cookie, { ids: [""] }, { origin: s.base });
    assert.equal(r4.status, 400);
    // เกิน 50
    const many = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    const r5 = await call("POST", `${s.base}/api/admin/news/bulk-delete`, cookie, { ids: many }, { origin: s.base });
    assert.equal(r5.status, 400);
    // ทั้งหมดนี้ต้องไม่มีการลบจริง
    assert.equal(s.repo.existsById("a"), true);
  } finally {
    await s.close();
  }
});

test("F. bulk-delete: missing IDs truthful + dedupe", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(makeNews("a"));
    s.repo.insertNews(makeNews("b"));
    const cookie = await login(s.base, s.token);
    // ส่ง a, missing-x, a (ซ้ำ), b → dedupe เหลือ [a, missing-x, b]
    const r = await call("POST", `${s.base}/api/admin/news/bulk-delete`, cookie,
      { ids: ["a", "missing-x", "a", "b"] }, { origin: s.base });
    assert.equal(r.status, 200);
    assert.deepEqual(r.payload.deletedIds.sort(), ["a", "b"]);
    assert.deepEqual(r.payload.notFoundIds, ["missing-x"], "missing ต้องอยู่ใน notFoundIds ไม่ใช่ deletedIds");
    assert.equal(r.payload.requested, 3, "dedupe แล้วต้องเหลือ 3 (a, missing-x, b)");
  } finally {
    await s.close();
  }
});

// ============ Static frontend assertions ============

test("G. admin.js: fetchAll controls present", () => {
  assert.match(ADMIN_JS, /id="fetchFetchAll"/, "ต้องมี checkbox fetchFetchAll");
  assert.match(ADMIN_JS, /ดึงทั้งหมดที่มี/, "label ต้องเป็น 'ดึงทั้งหมดที่มี'");
  // เมื่อเปิด fetchAll ต้อง disable numeric input
  assert.match(ADMIN_JS, /state\.fetchFetchAll \|\| controlsBusy/, "numeric input ต้อง disabled เมื่อ fetchAll");
  // ส่ง fetchAll ไป backend
  assert.match(ADMIN_JS, /fetchAll/, "ต้องส่ง fetchAll ใน body ของ /api/admin/run");
});

test("H. admin.js: selection + bulk delete selectors present", () => {
  assert.match(ADMIN_JS, /data-news-select/, "checkbox แต่ละแถวต้องมี data-news-select");
  assert.match(ADMIN_JS, /id="newsSelectAll"/, "ต้องมี select-all checkbox");
  assert.match(ADMIN_JS, /id="adminBulkDeleteBtn"/, "ต้องมีปุ่ม bulk delete");
  assert.match(ADMIN_JS, /id="newsSelectedCount"/, "ต้องมีตัวนับจำนวนที่เลือก");
  assert.match(ADMIN_JS, /ลบที่เลือก/, "label ปุ่ม bulk delete เป็น 'ลบที่เลือก'");
  assert.match(ADMIN_JS, /\/bulk-delete/, "ต้องเรียก endpoint bulk-delete");
  // ลบรายบุคคล + window.confirm ก่อนทั้ง single และ bulk
  assert.match(ADMIN_JS, /data-act="delete"/, "ต้องมีปุ่มลบรายบุคคล");
  assert.match(ADMIN_JS, /window\.confirm/, "ต้องเรียก window.confirm ก่อนลบ");
});

test("I. layout.js: no nav-theme-btn (dark mode removed)", () => {
  assert.doesNotMatch(LAYOUT_JS, /nav-theme-btn/, "ต้องไม่มี nav-theme-btn");
});

test("J. admin.js: refreshes news automatically and shows notifications", () => {
  assert.match(ADMIN_JS, /refreshNewsAfterRun\(beforeRun, expectedSaved\)/,
    "หลังดึงข่าวต้อง refresh/retry รายการข่าวอัตโนมัติ");
  assert.match(ADMIN_JS, /Promise\.all\(\[loadStatus\(\), loadCounts\(\), loadNews\(\)\]\)/,
    "auto-refresh ต้องโหลดรายการข่าว ไม่ใช่แค่สถานะและยอดรวม");
  assert.match(ADMIN_JS, /id = "adminToastRegion"/,
    "ต้องมี notification region แยกจาก dashboard ที่ re-render");
  assert.match(ADMIN_JS, /showToast\(type, summary\)/,
    "ผลสำเร็จหรือผิดพลาดของ operation ต้องแสดง toast");
});

test("K. admin.js: published news remains editable and shows warning marks", () => {
  assert.match(ADMIN_JS, /n\.publishStatus === "published" \? "แก้ไขข่าว" : "แก้ไข\/ตรวจ"/,
    "ข่าว published ต้องมีปุ่มแก้ไขข่าว");
  assert.match(ADMIN_JS, /⚠ ควรตรวจ \$\{publishWarnings\.length\} จุด/,
    "รายการข่าวต้องแสดงจำนวนคำเตือน");
  assert.match(ADMIN_JS, /ข่าวยังเผยแพร่อยู่/,
    "หลังแก้ข่าว published ต้องแจ้งว่ายังคงเผยแพร่");
});
