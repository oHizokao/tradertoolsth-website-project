/* ============================================================
   Admin manual news fetch — POST /api/admin/run
   ------------------------------------------------------------
   ครอบคลุมการ "ดึงข่าวแบบกำหนดค่าได้" (maxPerRun + ตัวเลือกภาพ):
     A. Authorization: ไม่มี cookie/Bearer → 401
     B. CSRF/Origin: origin ผิด → 403 (cookie auth อย่างเดียวไม่พอ)
     C. ส่ง maxPerRun + withImages ผ่านถึง updater.run ได้ถูกต้อง
     D. withImages:false (หรือ skipImage:true) → skipImage:true
     E. maxPerRun ถูก clamp ภายใน 1-10 (เกิน/ต่ำกว่า/ไม่ใช่ตัวเลข)
     F. autoPublish เป็น false เสมอ (manual fetch ไม่เผยแพร่เอง)
     G. skipped (รอบกำลังทำงาน) → 202

   ใช้ injectable updater (fake) ไม่ยิง scraper/AI/Pexels จริง
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createHttpServer, listen } from "../src/api/server.js";
import { resolve } from "node:path";

const projectRoot = resolve(process.cwd(), "..");

function makeTestToken() {
  return "test-" + randomBytes(16).toString("hex");
}

async function makeServer({ updater } = {}) {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const token = makeTestToken();
  const server = createHttpServer({
    repo,
    updater,
    // Enable the shared admin login namespace; this suite injects updater
    // rather than exercising auto-pilot actions.
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
  const sc = res.headers.get("set-cookie");
  return sc.split(";")[0];
}

async function run(base, cookie, body, { origin } = {}) {
  const init = {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
    redirect: "manual",
  };
  if (origin !== undefined) init.headers.origin = origin;
  const res = await fetch(base + "/api/admin/run", init);
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { status: res.status, payload: payload || {} };
}

test("A. /api/admin/run ไม่มี auth → 401", async () => {
  const updater = { run: async () => ({ ok: true }) };
  const s = await makeServer({ updater });
  try {
    const res = await fetch(s.base + "/api/admin/run", {
      method: "POST",
      headers: { "content-type": "application/json", origin: s.base },
      body: JSON.stringify({ maxPerRun: 3 }),
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
    assert.equal(updater.run.called, undefined, "ต้องไม่เรียก updater เมื่อ unauth");
  } finally {
    await s.close();
  }
});

test("B. /api/admin/run origin ผิด → 403 (CSRF) แม้มี cookie", async () => {
  const updater = { run: async () => ({ ok: true }) };
  const s = await makeServer({ updater });
  try {
    const cookie = await login(s.base, s.token);
    const r = await run(s.base, cookie, { maxPerRun: 3 }, { origin: "http://evil.example.com" });
    assert.equal(r.status, 403);
    assert.equal(r.payload.error, "origin_not_allowed");
  } finally {
    await s.close();
  }
});

test("C. ส่ง maxPerRun + withImages ผ่านถึง updater.run ถูกต้อง (self origin)", async () => {
  const calls = [];
  const updater = {
    run: async (opts) => {
      calls.push(opts);
      return { ok: true, saved: [], duplicates: [], failed: [] };
    },
  };
  const s = await makeServer({ updater });
  try {
    const cookie = await login(s.base, s.token);
    const r = await run(s.base, cookie, { maxPerRun: 5, withImages: true }, { origin: s.base });
    assert.equal(r.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].maxPerRun, 5);
    assert.equal(calls[0].autoPublish, false, "manual fetch ต้องไม่ auto-publish");
    assert.equal(calls[0].skipImage, false, "withImages:true → skipImage:false");
  } finally {
    await s.close();
  }
});

test("D. withImages:false → skipImage:true (ข้ามการดึงรูป)", async () => {
  const calls = [];
  const updater = { run: async (opts) => { calls.push(opts); return { ok: true }; } };
  const s = await makeServer({ updater });
  try {
    const cookie = await login(s.base, s.token);
    await run(s.base, cookie, { maxPerRun: 3, withImages: false }, { origin: s.base });
    assert.equal(calls[0].skipImage, true);
    // legacy alias skipImage:true ก็ต้องให้ผลเดียวกัน
    await run(s.base, cookie, { maxPerRun: 3, skipImage: true }, { origin: s.base });
    assert.equal(calls[1].skipImage, true);
  } finally {
    await s.close();
  }
});

test("E. maxPerRun ถูก clamp ภายใน 1-10", async () => {
  const calls = [];
  const updater = { run: async (opts) => { calls.push(opts.maxPerRun); return { ok: true }; } };
  const s = await makeServer({ updater });
  try {
    const cookie = await login(s.base, s.token);
    await run(s.base, cookie, { maxPerRun: 999 }, { origin: s.base });   // → 10
    await run(s.base, cookie, { maxPerRun: 0 }, { origin: s.base });     // → 1
    await run(s.base, cookie, { maxPerRun: "abc" }, { origin: s.base }); // → default 3
    await run(s.base, cookie, { maxPerRun: 7 }, { origin: s.base });     // → 7
    assert.deepEqual(calls, [10, 1, 3, 7]);
  } finally {
    await s.close();
  }
});

test("G. updater รายงาน skipped → 202", async () => {
  const updater = { run: async () => ({ ok: true, skipped: true, reason: "already_running" }) };
  const s = await makeServer({ updater });
  try {
    const cookie = await login(s.base, s.token);
    const r = await run(s.base, cookie, { maxPerRun: 3 }, { origin: s.base });
    assert.equal(r.status, 202);
    assert.equal(r.payload.skipped, true);
  } finally {
    await s.close();
  }
});
