/* ============================================================
   Phase 10 — Admin Dashboard (cookie auth + CSRF/Origin) tests
   ------------------------------------------------------------
   ครอบคลุม 14 เคสตามข้อกำหนด:
     1. login ถูก → 200 + Set-Cookie HttpOnly + SameSite
     2. login ผิด → 401
     3. login ตรวจ Origin ผิด → 403
     4. login แล้ว cookie ใช้เรียก status/session ได้
     5. ไม่มี cookie/Bearer → status/enable 401
     6. enable/disable ด้วย cookie + Origin ถูก → 200
     7. enable ด้วย cookie + Origin ผิด → 403
     8. enable ด้วย Bearer + Origin ถูก → 200 (script path คงรองรับ)
     9. run-once ระหว่าง running → 202 skipped
     10. emergency-stop + clear-emergency
     11. 409 (env ปิด → enable fail)
     12. logout → cookie cleared
     13. ไม่มี secret leak ใน response ใดๆ
     14. session endpoint คืน authenticated true/false ถูก

   กฎ QC: ใช้ TEST TOKEN (random) เท่านั้น — ห้ามใช้ ADMIN_TOKEN จริงจาก env
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createAutoPilotRepository } from "../src/store/autoPilotRepository.js";
import { createAuditRepository } from "../src/store/auditRepository.js";
import { createAutoPilot } from "../src/autopilot/autoPilot.js";
import { createHttpServer, listen } from "../src/api/server.js";
import { resolve } from "node:path";

const projectRoot = resolve(process.cwd(), "..");

/** test token random ต่อ test run — ห้ามใช้ ADMIN_TOKEN จริง */
function makeTestToken() {
  return "test-" + randomBytes(16).toString("hex");
}

/** สร้าง server + repos พร้อม autoPilot mock (env allowed ควบคุมได้) */
async function makeServer(opts = {}) {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const apRepo = createAutoPilotRepository(db);
  const auditRepo = createAuditRepository(db);
  const envAllowed = opts.envAllowed ?? true;
  const autoPilot = createAutoPilot(
    { repo, apRepo, auditRepo },
    {
      fetchDigestFn: async () => ({ items: [], needsReview: [] }),
      fetchArticlesFn: async () => ({ results: [], errors: [] }),
      processBatchFn: async () => ({ results: [], saved: [], duplicates: [], failed: [] }),
      envAllowed,
    }
  );
  const token = opts.token || makeTestToken();
  const server = createHttpServer({
    repo,
    autoPilot,
    auditRepo,
    projectRoot,
    siteVersion: "2",
    adminToken: token,
    adminAllowedOrigins: opts.adminAllowedOrigins || [],
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  return {
    server,
    base: `http://127.0.0.1:${address.port}`,
    token,
    autoPilot,
    db,
    close: async () => {
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}

/** fetch helper ที่รองรับ cookie/origin/auth */
async function req(base, method, path, opts = {}) {
  const init = { method, headers: {} };
  if (opts.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  if (opts.origin !== undefined) init.headers["origin"] = opts.origin;
  if (opts.cookie) init.headers["cookie"] = opts.cookie;
  if (opts.auth) init.headers["authorization"] = "Bearer " + opts.auth;
  const res = await fetch(base + path, init);
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return {
    status: res.status,
    setCookie: res.headers.get("set-cookie"),
    payload: payload || {},
  };
}

const AP = "/api/admin/auto-pilot";

/* ---------- 1. login ถูก → 200 + HttpOnly + SameSite ---------- */
test("1. login valid → 200 + HttpOnly + SameSite cookie", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base,
    });
    assert.equal(r.status, 200);
    assert.ok(r.setCookie, "ต้องมี Set-Cookie");
    assert.match(r.setCookie, /HttpOnly/i);
    assert.match(r.setCookie, /SameSite=Strict/i);
    assert.match(r.setCookie, /Path=\/api\/admin/i);
    // Phase 16: Path ขยายจาก /api/admin/auto-pilot → /api/admin
    // เพื่อให้ cookie ครอบคลุม content API ด้วย (ไม่ใช่ auto-pilot-only)
    assert.equal(/Path=\/api\/admin\/auto-pilot/i.test(r.setCookie), false,
      "Path ต้องไม่ใช่ /api/admin/auto-pilot อีกต่อไป");
    assert.match(r.setCookie, /Max-Age=28800/i);
  } finally {
    await s.close();
  }
});

/* ---------- 2. login ผิด → 401 ---------- */
test("2. login invalid → 401", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", AP + "/login", {
      body: { token: "wrong-token" },
      origin: s.base,
    });
    assert.equal(r.status, 401);
    assert.equal(r.payload.error, "invalid_token");
    assert.equal(r.setCookie, null);
  } finally {
    await s.close();
  }
});

/* ---------- 3. login ตรวจ Origin ผิด → 403 ---------- */
test("3. login bad origin → 403", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: "http://evil.example.com",
    });
    assert.equal(r.status, 403);
    assert.equal(r.payload.error, "origin_not_allowed");
  } finally {
    await s.close();
  }
});

/* ---------- 4. login แล้ว cookie ใช้เรียก status/session ได้ ---------- */
test("4. cookie auth → status/session work", async () => {
  const s = await makeServer();
  try {
    const login = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base,
    });
    const cookie = login.setCookie.split(";")[0];

    const sess = await req(s.base, "GET", AP + "/session", { cookie });
    assert.equal(sess.status, 200);
    assert.equal(sess.payload.authenticated, true);

    const status = await req(s.base, "GET", AP + "/status", { cookie });
    assert.equal(status.status, 200);
    assert.ok(status.payload.status !== undefined);
  } finally {
    await s.close();
  }
});

/* ---------- 5. ไม่มี cookie/Bearer → status/enable 401 ---------- */
test("5. no auth → 401", async () => {
  const s = await makeServer();
  try {
    const status = await req(s.base, "GET", AP + "/status");
    assert.equal(status.status, 401);
    const enable = await req(s.base, "POST", AP + "/enable", { origin: s.base });
    assert.equal(enable.status, 401);
  } finally {
    await s.close();
  }
});

/* ---------- 6. enable/disable ด้วย cookie + Origin ถูก → 200 ---------- */
test("6. enable/disable with cookie + valid origin → 200", async () => {
  const s = await makeServer();
  try {
    const login = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base,
    });
    const cookie = login.setCookie.split(";")[0];

    const enable = await req(s.base, "POST", AP + "/enable", { cookie, origin: s.base });
    assert.equal(enable.status, 200);
    assert.equal(enable.payload.status.status, "idle");

    const disable = await req(s.base, "POST", AP + "/disable", { cookie, origin: s.base });
    assert.equal(disable.status, 200);
    assert.equal(disable.payload.status.status, "off");
  } finally {
    await s.close();
  }
});

/* ---------- 7. enable ด้วย cookie + Origin ผิด → 403 ---------- */
test("7. enable with cookie + bad origin → 403", async () => {
  const s = await makeServer();
  try {
    const login = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base,
    });
    const cookie = login.setCookie.split(";")[0];

    const enable = await req(s.base, "POST", AP + "/enable", {
      cookie,
      origin: "http://evil.example.com",
    });
    assert.equal(enable.status, 403);
    assert.equal(enable.payload.error, "origin_not_allowed");
  } finally {
    await s.close();
  }
});

/* ---------- 8. enable ด้วย Bearer + Origin ถูก → 200 (script path) ---------- */
test("8. enable with Bearer + valid origin → 200 (script supported)", async () => {
  const s = await makeServer();
  try {
    const enable = await req(s.base, "POST", AP + "/enable", {
      auth: s.token,
      origin: s.base,
    });
    assert.equal(enable.status, 200);
  } finally {
    await s.close();
  }
});

/* ---------- 9. run-once ระหว่าง running → 202 skipped ---------- */
test("9. run-once while running → 202 skipped", async () => {
  const s = await makeServer();
  try {
    const login = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base,
    });
    const cookie = login.setCookie.split(";")[0];
    await req(s.base, "POST", AP + "/enable", { cookie, origin: s.base });
    // จำลองกำลังรัน — acquire lock
    s.autoPilot.runOnce({ maxPerRun: 1 }).catch(() => {});
    // รอสักครู่ให้ lock ถูก acquire
    await new Promise((r) => setTimeout(r, 50));
    const r2 = await req(s.base, "POST", AP + "/run-once", { cookie, origin: s.base });
    assert.ok(r2.status === 202 || r2.status === 409, `status=${r2.status}`);
  } finally {
    await s.close();
  }
});

/* ---------- 10. emergency-stop + clear-emergency ---------- */
test("10. emergency-stop + clear-emergency", async () => {
  const s = await makeServer();
  try {
    const login = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base,
    });
    const cookie = login.setCookie.split(";")[0];

    const stop = await req(s.base, "POST", AP + "/emergency-stop", { cookie, origin: s.base });
    assert.equal(stop.status, 200);
    assert.equal(stop.payload.status.emergencyStop, true);

    const clear = await req(s.base, "POST", AP + "/clear-emergency", { cookie, origin: s.base });
    assert.equal(clear.status, 200);
    assert.equal(clear.payload.status.emergencyStop, false);
  } finally {
    await s.close();
  }
});

/* ---------- 11. 409 (env ปิด → enable fail) ---------- */
test("11. enable when env disabled → 409", async () => {
  const s = await makeServer({ envAllowed: false });
  try {
    const login = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base,
    });
    const cookie = login.setCookie.split(";")[0];

    const enable = await req(s.base, "POST", AP + "/enable", { cookie, origin: s.base });
    assert.equal(enable.status, 409);
    assert.equal(enable.payload.error, "env_not_allowed");
  } finally {
    await s.close();
  }
});

/* ---------- 12. logout → cookie cleared ---------- */
test("12. logout → cookie cleared (Max-Age=0)", async () => {
  const s = await makeServer();
  try {
    const login = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base,
    });
    const cookie = login.setCookie.split(";")[0];

    const out = await req(s.base, "POST", AP + "/logout", { cookie, origin: s.base });
    assert.equal(out.status, 200);
    // backend สั่ง clear cookie (browser จะลบทันที — จำลองโดยไม่ส่ง cookie กลับ)
    assert.match(out.setCookie, /Max-Age=0/i);

    // จำลอง browser ที่ลบ cookie แล้ว (ไม่ส่ง cookie) → session ต้อง false
    const sess = await req(s.base, "GET", AP + "/session");
    assert.equal(sess.payload.authenticated, false);
  } finally {
    await s.close();
  }
});

/* ---------- 13. ไม่มี secret leak ใน response ใดๆ ---------- */
test("13. no secret leak in any response", async () => {
  const s = await makeServer();
  try {
    const login = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base,
    });
    const cookie = login.setCookie.split(";")[0];

    // เก็บ response ทุก endpoint
    const responses = [
      login.payload,
      (await req(s.base, "GET", AP + "/status", { cookie })).payload,
      (await req(s.base, "GET", AP + "/session", { cookie })).payload,
      (await req(s.base, "POST", AP + "/emergency-stop", { cookie, origin: s.base })).payload,
      (await req(s.base, "POST", AP + "/clear-emergency", { cookie, origin: s.base })).payload,
    ];
    const dump = JSON.stringify(responses);
    // ห้ามมี test token จริงใน body ใดๆ
    assert.equal(dump.includes(s.token), false, "response ต้องไม่ leak test token");
    assert.equal(dump.includes("adminToken"), false);
    assert.equal(dump.includes("apiKey"), false);
    assert.equal(dump.includes("OPENAI_API_KEY"), false);
  } finally {
    await s.close();
  }
});

/* ---------- 14. session endpoint คืน authenticated true/false ถูก ---------- */
test("14. session returns authenticated true/false correctly", async () => {
  const s = await makeServer();
  try {
    // ก่อน login → false
    const before = await req(s.base, "GET", AP + "/session");
    assert.equal(before.status, 200);
    assert.equal(before.payload.authenticated, false);

    // login
    const login = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base,
    });
    const cookie = login.setCookie.split(";")[0];

    // หลัง login → true
    const after = await req(s.base, "GET", AP + "/session", { cookie });
    assert.equal(after.payload.authenticated, true);

    // หลัง logout (browser ลบ cookie แล้ว → ไม่ส่ง cookie) → false
    await req(s.base, "POST", AP + "/logout", { cookie, origin: s.base });
    const postLogout = await req(s.base, "GET", AP + "/session");
    assert.equal(postLogout.payload.authenticated, false);
  } finally {
    await s.close();
  }
});

/* ---------- extra: GET (status/session) ไม่ต้องตรวจ Origin ---------- */
test("extra: GET safe methods bypass origin check", async () => {
  const s = await makeServer();
  try {
    const login = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base,
    });
    const cookie = login.setCookie.split(";")[0];
    // GET status ด้วย origin อื่น → ต้องผ่าน (safe method)
    const status = await req(s.base, "GET", AP + "/status", {
      cookie,
      origin: "http://other.example.com",
    });
    assert.equal(status.status, 200);
  } finally {
    await s.close();
  }
});

/* ---------- extra: allowlist origin ---------- */
test("extra: allowlist origin honored", async () => {
  const s = await makeServer({ adminAllowedOrigins: ["http://127.0.0.1:9999"] });
  try {
    // origin ใน allowlist → ผ่าน
    const ok = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: "http://127.0.0.1:9999",
    });
    assert.equal(ok.status, 200);
    // origin ไม่ใน allowlist → 403
    const bad = await req(s.base, "POST", AP + "/login", {
      body: { token: s.token },
      origin: s.base, // ไม่ใช่ allowlist → ปฏิเสธ
    });
    assert.equal(bad.status, 403);
  } finally {
    await s.close();
  }
});
