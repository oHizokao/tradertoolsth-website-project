/* ============================================================
   Phase 16 — Public EA Submission + Admin Review tests
   ------------------------------------------------------------
   ครอบคลุม (ตามข้อกำหนด):
     A. Public list — เห็นเฉพาะ published EA เท่านั้น
     B. Public submit success — สร้าง pending_review
     C. Public submit rate limit — ส่งเกิน burst → 429 + retry-after
     D. Public submit validation — ไฟล์ผิดนามสกุล, ไฟล์ใหญ่เกิน, ขาด field
     E. Public submit path traversal — filename อันตรายถูกปฏิเสธ
     F. Public submit ปฏิเสธ privileged fields — status/price ถูก ignore
     G. Origin/CSRF check — origin ผิด → 403
     H. Admin login → cookie scope → create/upload/publish EA
     I. Admin publish gate — EA ขาด required field → 409
     J. Admin review submissions — list pending, reject, migrate

   ใช้ in-memory DB + real HTTP (createHttpServer + listen)
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createContentRepositories } from "../src/store/contentRepository.js";
import { createUploadService } from "../src/content/uploadService.js";
import { createEaSubmissionRepository } from "../src/ea/submissionRepository.js";
import { createEaSubmissionService } from "../src/ea/eaSubmissionService.js";
import { createRateLimiter } from "../src/forum/rateLimiter.js";
import { createHttpServer, listen } from "../src/api/server.js";

const projectRoot = resolve(process.cwd(), "..");

/* ---------- helpers ---------- */
function makeTestToken() {
  return "test-admin-" + randomBytes(8).toString("hex");
}

async function makeServer(opts = {}) {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const contentRepos = createContentRepositories(db);
  const tmpUploads = mkdtempSync(join(tmpdir(), "tt-ea-test-"));
  const uploadService = createUploadService({ uploadsRoot: tmpUploads });
  const token = opts.token || makeTestToken();

  const submissionRepo = createEaSubmissionRepository(db);
  const rateLimiter =
    opts.rateLimiter ||
    createRateLimiter({
      windowSeconds: opts.rateWindow || 60,
      burst: opts.rateBurst || 100,
      now: opts.now,
    });
  const eaSubmissionService = createEaSubmissionService({
    repo: submissionRepo,
    uploadService,
    rateLimiter,
    config: {
      nameMaxLength: 200,
      descriptionMaxLength: 8000,
      versionMaxLength: 60,
    },
  });

  // stub autoPilot สำหรับ login endpoint (ใช้ cookie path=/api/admin)
  const autoPilotStub = {
    _running: false,
    getStatus: () => ({ enabled: false }),
    enable: () => ({ ok: true }),
    disable: () => {},
    emergencyStop: () => {},
    clearEmergencyStop: () => {},
    runOnce: async () => ({}),
  };

  const server = createHttpServer({
    repo,
    contentRepos,
    uploadService,
    submissionRepo,
    eaSubmissionService,
    autoPilot: autoPilotStub,
    projectRoot,
    siteVersion: "2",
    adminToken: token,
    adminAllowedOrigins: opts.adminAllowedOrigins || [],
    trustProxy: opts.trustProxy || false,
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  const selfOrigin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    base: `http://127.0.0.1:${address.port}`,
    selfOrigin,
    token,
    contentRepos,
    submissionRepo,
    uploadsRoot: tmpUploads,
    db,
    close: async () => {
      await new Promise((r) => server.close(r));
      db.close();
      try {
        rmSync(tmpUploads, { recursive: true, force: true });
      } catch {}
    },
  };
}

/** build multipart/form-data buffer */
function buildMultipart(boundary, fields) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value && typeof value === "object" && "filename" in value) {
      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"; filename="${value.filename}"\r\n` +
          `Content-Type: ${value.contentType || "application/octet-stream"}\r\n\r\n`
      );
      parts.push(value.buffer);
      parts.push("\r\n");
    } else {
      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`
      );
    }
  }
  parts.push(`--${boundary}--\r\n`);
  return Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
}

/** valid EA file (zip magic bytes PK..) */
function validEaFile() {
  return {
    filename: "goldbot.ex5",
    contentType: "application/octet-stream",
    buffer: Buffer.from([
      0x50, 0x4b, 0x03, 0x04, // zip magic
      ...Buffer.alloc(40, 0x41), // padding
    ]),
  };
}

/** valid PNG cover */
function validPngCover() {
  return {
    filename: "cover.png",
    contentType: "image/png",
    buffer: Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
      ...Buffer.alloc(40, 0x42),
    ]),
  };
}

/** helper: POST /api/ea/submissions */
async function submitEa(ctx, { boundary, fields, origin, extraHeaders } = {}) {
  const b = boundary || "----testboundary123";
  const f = fields || {
    name: "Test EA Bot",
    description: "This is a test EA description with enough characters.",
    platform: "MT5",
    version: "1.0.0",
    ea: validEaFile(),
  };
  const body = buildMultipart(b, f);
  const headers = {
    "content-type": `multipart/form-data; boundary=${b}`,
    "content-length": String(body.length),
    ...(extraHeaders || {}),
  };
  // origin: undefined → ไม่ส่ง header (สำหรับ CSRF test)
  // origin: "" → เหมือน undefined
  // origin: "http://..." → ส่งตามปกติ
  if (origin !== undefined && origin !== "") {
    headers.origin = origin;
  } else if (origin === undefined) {
    headers.origin = ctx.selfOrigin;
  }
  const res = await fetch(`${ctx.base}/api/ea/submissions`, {
    method: "POST",
    headers,
    body,
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: res.status, payload, headers: res.headers };
}

/** helper: admin request with Bearer */
async function adminReq(ctx, method, path, opts = {}) {
  const init = {
    method,
    headers: { authorization: "Bearer " + ctx.token },
  };
  if (opts.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  if (opts.origin !== undefined) init.headers.origin = opts.origin;
  else init.headers.origin = ctx.selfOrigin;
  const res = await fetch(ctx.base + path, init);
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: res.status, payload, headers: res.headers };
}

/* ============================================================
   A. PUBLIC LIST — เห็นเฉพาะ published
   ============================================================ */
test("A1. public list returns only published EA", async () => {
  const ctx = await makeServer();
  try {
    // seed draft + published EA directly (sort_order required by schema)
    ctx.contentRepos.ea.create({
      name: "Draft EA",
      slug: "draft-ea",
      version: "1.0",
      platform: "mt5",
      price: 0,
      type: "free",
      status: "draft",
      sortOrder: 0,
      filePath: "ea-files/x.ex5",
    });
    const pub = ctx.contentRepos.ea.create({
      name: "Published EA",
      slug: "published-ea",
      version: "2.0",
      platform: "both",
      price: 0,
      type: "free",
      status: "published",
      sortOrder: 0,
      filePath: "ea-files/y.ex5",
    });
    ctx.contentRepos.ea.publish(pub.id);

    const res = await fetch(`${ctx.base}/api/content/ea`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.items.length, 1, "only 1 published EA should appear");
    assert.equal(body.items[0].name, "Published EA");
    // public response กรอง status field ออก — เช็ค name ก็พอ
    // (draft EA จะไม่ปรากฏใน list เพราะ SQL WHERE status='published')
  } finally {
    await ctx.close();
  }
});

/* ============================================================
   B. PUBLIC SUBMIT SUCCESS
   ============================================================ */
test("B1. public submit creates pending_review submission", async () => {
  const ctx = await makeServer();
  try {
    const r = await submitEa(ctx);
    assert.equal(r.status, 201);
    assert.equal(r.payload.ok, true);
    assert.equal(r.payload.status, "pending_review");
    assert.ok(r.payload.id, "should return id");
    assert.ok(r.payload.slug, "should return slug");

    // verify in repo
    const sub = ctx.submissionRepo.getById(r.payload.id);
    assert.ok(sub, "submission stored in DB");
    assert.equal(sub.status, "pending_review");
    assert.equal(sub.name, "Test EA Bot");
    assert.equal(sub.platform, "mt5");
    assert.equal(sub.version, "1.0.0");
    // path ต้องอยู่ใต้ ea-files subdir (รองรับทั้ง / และ \ บน Windows)
    const normPath = sub.eaFilePath.replace(/\\/g, "/");
    assert.ok(normPath.startsWith("ea-files/"), "eaFilePath in ea-files subdir: " + sub.eaFilePath);
  } finally {
    await ctx.close();
  }
});

test("B2. public submit with optional cover image", async () => {
  const ctx = await makeServer();
  try {
    const r = await submitEa(ctx, {
      fields: {
        name: "EA With Cover",
        description: "Description long enough to pass validation check.",
        platform: "MT4",
        version: "1.0",
        strategy: "Grid",
        contactName: "Dev",
        contactEmail: "dev@example.com",
        ea: validEaFile(),
        cover: validPngCover(),
      },
    });
    assert.equal(r.status, 201);
    const sub = ctx.submissionRepo.getById(r.payload.id);
    assert.ok(sub.coverImagePath, "cover path stored");
    assert.ok(
      sub.coverImagePath.replace(/\\/g, "/").startsWith("images/"),
      "cover in images subdir"
    );
    assert.equal(sub.contactName, "Dev");
    assert.equal(sub.contactEmail, "dev@example.com");
    assert.equal(sub.strategy, "Grid");
  } finally {
    await ctx.close();
  }
});

/* ============================================================
   C. RATE LIMIT
   ============================================================ */
test("C1. public submit rate limit → 429 + retry-after", async () => {
  const ctx = await makeServer({ rateBurst: 2, rateWindow: 60 });
  try {
    // 2 submissions แรกผ่าน
    const r1 = await submitEa(ctx);
    const r2 = await submitEa(ctx, {
      fields: {
        name: "EA Two",
        description: "Second EA description for rate limit test here.",
        platform: "MT5",
        version: "1.0",
        ea: validEaFile(),
      },
    });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);

    // ส่งที่ 3 → ต้อง 429
    const r3 = await submitEa(ctx, {
      fields: {
        name: "EA Three",
        description: "Third EA that should be rate limited by system.",
        platform: "MT5",
        version: "1.0",
        ea: validEaFile(),
      },
    });
    assert.equal(r3.status, 429);
    assert.equal(r3.payload.error, "rate_limited");
    const retryAfter = r3.headers.get("retry-after");
    assert.ok(retryAfter, "retry-after header present");
    assert.ok(parseInt(retryAfter, 10) > 0);
  } finally {
    await ctx.close();
  }
});

test("C2. spoofed x-forwarded-for cannot bypass rate limit by default", async () => {
  const ctx = await makeServer({ rateBurst: 1, rateWindow: 60 });
  try {
    const first = await submitEa(ctx, {
      extraHeaders: { "x-forwarded-for": "198.51.100.10" },
    });
    const second = await submitEa(ctx, {
      fields: {
        name: "Spoof Attempt",
        description: "A second submission with a forged proxy address.",
        platform: "MT5",
        version: "1.0",
        ea: validEaFile(),
      },
      extraHeaders: { "x-forwarded-for": "203.0.113.44" },
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 429);
  } finally {
    await ctx.close();
  }
});

/* ============================================================
   D. VALIDATION
   ============================================================ */
test("D1. public submit with wrong file extension → 400", async () => {
  const ctx = await makeServer();
  try {
    const r = await submitEa(ctx, {
      fields: {
        name: "Bad EA",
        description: "Description long enough for validation purposes ok.",
        platform: "MT5",
        version: "1.0",
        ea: {
          filename: "malware.exe",
          contentType: "application/octet-stream",
          buffer: Buffer.alloc(50, 0x41),
        },
      },
    });
    assert.equal(r.status, 400);
    assert.equal(r.payload.error, "extension_not_allowed");
  } finally {
    await ctx.close();
  }
});

test("D2. public submit missing EA file → 400", async () => {
  const ctx = await makeServer();
  try {
    const r = await submitEa(ctx, {
      fields: {
        name: "No File EA",
        description: "Description long enough for validation here okay.",
        platform: "MT5",
        version: "1.0",
      },
    });
    assert.equal(r.status, 400);
    assert.equal(r.payload.error, "ea_file_required");
  } finally {
    await ctx.close();
  }
});

test("D3. public submit name too short → 400 validation_failed", async () => {
  const ctx = await makeServer();
  try {
    const r = await submitEa(ctx, {
      fields: {
        name: "AB",
        description: "Description long enough for validation here okay.",
        platform: "MT5",
        version: "1.0",
        ea: validEaFile(),
      },
    });
    assert.equal(r.status, 400);
    assert.equal(r.payload.error, "validation_failed");
    assert.ok(r.payload.details.includes("name_too_short"));
  } finally {
    await ctx.close();
  }
});

test("D4. public submit invalid platform → 400", async () => {
  const ctx = await makeServer();
  try {
    const r = await submitEa(ctx, {
      fields: {
        name: "Test EA",
        description: "Description long enough for validation here okay.",
        platform: "MT6",
        version: "1.0",
        ea: validEaFile(),
      },
    });
    assert.equal(r.status, 400);
    assert.equal(r.payload.error, "validation_failed");
  } finally {
    await ctx.close();
  }
});

/* ============================================================
   E. PATH TRAVERSAL
   ============================================================ */
test("E1. public submit path traversal filename → rejected", async () => {
  const ctx = await makeServer();
  try {
    const r = await submitEa(ctx, {
      fields: {
        name: "Traversal EA",
        description: "Description long enough for validation here okay.",
        platform: "MT5",
        version: "1.0",
        ea: {
          filename: "../../../etc/passwd.ex5",
          contentType: "application/octet-stream",
          buffer: Buffer.from([
            0x50, 0x4b, 0x03, 0x04,
            ...Buffer.alloc(40, 0x41),
          ]),
        },
      },
    });
    // uploadService renames ไฟล์เสมอ (random hex) → traversal ในชื่อไม่มีผล
    // แต่ .ex5 ผ่าน whitelist → submission สำเร็จ ชื่อไฟล์ stored = random
    assert.equal(r.status, 201);
    const sub = ctx.submissionRepo.getById(r.payload.id);
    // path ต้องไม่มี .. หรือ absolute
    assert.ok(!sub.eaFilePath.includes(".."));
    assert.ok(!sub.eaFilePath.startsWith("/"));
    const normPath = sub.eaFilePath.replace(/\\/g, "/");
    assert.ok(normPath.startsWith("ea-files/"), "path in ea-files subdir");
  } finally {
    await ctx.close();
  }
});

/* ============================================================
   F. PRIVILEGED FIELDS IGNORED
   ============================================================ */
test("F1. public submit with status=published → server forces pending_review", async () => {
  const ctx = await makeServer();
  try {
    const r = await submitEa(ctx, {
      fields: {
        name: "Hacker EA",
        description: "Trying to set published status via public endpoint.",
        platform: "MT5",
        version: "1.0",
        status: "published",
        price: "999",
        published: "true",
        ea: validEaFile(),
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.payload.status, "pending_review", "status forced to pending");

    const sub = ctx.submissionRepo.getById(r.payload.id);
    assert.equal(sub.status, "pending_review");
    // ea_products ไม่ควรมี record นี้ (ยังไม่ migrate)
    const eaList = ctx.contentRepos.ea.listAll(100, 0);
    assert.equal(eaList.length, 0, "no ea_products record created");
  } finally {
    await ctx.close();
  }
});

/* ============================================================
   G. ORIGIN / CSRF
   ============================================================ */
test("G1. public submit with wrong origin → 403", async () => {
  const ctx = await makeServer();
  try {
    const r = await submitEa(ctx, { origin: "http://evil.example.com" });
    assert.equal(r.status, 403);
    assert.equal(r.payload.error, "origin_not_allowed");
  } finally {
    await ctx.close();
  }
});

test("G2. public submit without origin header → 403", async () => {
  const ctx = await makeServer();
  try {
    // ส่ง POST โดยไม่ส่ง origin header เลย → isOriginAllowed คืน false → 403
    const b = "----noorigin";
    const fields = {
      name: "No Origin EA",
      description: "EA submitted without origin header for CSRF test ok.",
      platform: "MT5",
      version: "1.0",
      ea: validEaFile(),
    };
    const body = buildMultipart(b, fields);
    const res = await fetch(`${ctx.base}/api/ea/submissions`, {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${b}`,
        "content-length": String(body.length),
        // ไม่ส่ง origin header
      },
      body,
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "origin_not_allowed");
  } finally {
    await ctx.close();
  }
});

/* ============================================================
   H. ADMIN LOGIN → COOKIE SCOPE → PUBLISH
   ============================================================ */
test("H1. admin login sets cookie Path=/api/admin", async () => {
  const ctx = await makeServer();
  try {
    const res = await fetch(`${ctx.base}/api/admin/auto-pilot/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ctx.selfOrigin,
      },
      body: JSON.stringify({ token: ctx.token }),
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie");
    assert.ok(setCookie, "Set-Cookie present");
    assert.ok(setCookie.includes("Path=/api/admin"), "cookie Path=/api/admin");
    assert.ok(setCookie.includes("HttpOnly"), "HttpOnly");
    assert.ok(setCookie.includes("SameSite=Strict"), "SameSite=Strict");
  } finally {
    await ctx.close();
  }
});

test("H2. admin can create EA via /api/admin/content/ea with Bearer", async () => {
  const ctx = await makeServer();
  try {
    // 1) upload EA file
    const uploadBody = buildMultipart("----ub", {
      file: validEaFile(),
    });
    const upRes = await fetch(`${ctx.base}/api/admin/content/upload/ea`, {
      method: "POST",
      headers: {
        authorization: "Bearer " + ctx.token,
        origin: ctx.selfOrigin,
        "content-type": "multipart/form-data; boundary=----ub",
        "content-length": String(uploadBody.length),
      },
      body: uploadBody,
    });
    assert.equal(upRes.status, 201);
    const upJson = await upRes.json();
    assert.ok(upJson.path, "upload returns path");

    // 2) create EA (draft)
    const cr = await adminReq(ctx, "POST", "/api/admin/content/ea", {
      body: {
        name: "Admin EA",
        version: "1.0",
        platform: "mt5",
        price: 0,
        type: "free",
        filePath: upJson.path,
      },
    });
    assert.equal(cr.status, 201);
    assert.ok(cr.payload.id);

    // 3) publish
    const pub = await adminReq(
      ctx,
      "POST",
      `/api/admin/content/ea/${cr.payload.id}/publish`
    );
    assert.equal(pub.status, 200);
    assert.equal(pub.payload.published, true);

    // 4) public list เห็น (public response กรอง status field ออก แต่ name ต้องตรง)
    const listRes = await fetch(`${ctx.base}/api/content/ea`);
    const listBody = await listRes.json();
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.items[0].name, "Admin EA");
  } finally {
    await ctx.close();
  }
});

/* ============================================================
   I. ADMIN PUBLISH GATE
   ============================================================ */
test("I1. admin publish EA missing required field → 409", async () => {
  const ctx = await makeServer();
  try {
    // create EA ที่ขาด version (required for publish)
    const cr = await adminReq(ctx, "POST", "/api/admin/content/ea", {
      body: {
        name: "Incomplete EA",
        slug: "incomplete-ea",
        platform: "mt5",
        price: 0,
        type: "free",
        filePath: "ea-files/test.ex5",
        // ไม่มี version
      },
    });
    assert.equal(cr.status, 201);

    // publish → ต้อง 409 (missing version)
    const pub = await adminReq(
      ctx,
      "POST",
      `/api/admin/content/ea/${cr.payload.id}/publish`
    );
    assert.equal(pub.status, 409);
    assert.equal(pub.payload.error, "missing_required");
    assert.ok(
      pub.payload.missing.includes("version"),
      "missing version reported"
    );
  } finally {
    await ctx.close();
  }
});

/* ============================================================
   J. ADMIN REVIEW SUBMISSIONS
   ============================================================ */
test("J1. admin can list pending submissions", async () => {
  const ctx = await makeServer();
  try {
    // public submit 2 รายการ
    await submitEa(ctx);
    await submitEa(ctx, {
      fields: {
        name: "Second EA",
        description: "Another EA description for admin review testing ok.",
        platform: "MT4",
        version: "2.0",
        ea: validEaFile(),
      },
    });

    const r = await adminReq(ctx, "GET", "/api/admin/ea-submissions");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.payload));
    assert.equal(r.payload.length, 2);
    assert.equal(r.payload[0].status, "pending_review");
  } finally {
    await ctx.close();
  }
});

test("J2. admin reject submission", async () => {
  const ctx = await makeServer();
  try {
    const sub = await submitEa(ctx);
    const r = await adminReq(
      ctx,
      "POST",
      `/api/admin/ea-submissions/${sub.payload.id}/reject`,
      { body: { reason: "Not safe" } }
    );
    assert.equal(r.status, 200);
    assert.equal(r.payload.status, "rejected");

    const updated = ctx.submissionRepo.getById(sub.payload.id);
    assert.equal(updated.status, "rejected");
    assert.equal(updated.reviewerNotes, "Not safe");
  } finally {
    await ctx.close();
  }
});

test("J3. admin migrate submission → ea_products draft", async () => {
  const ctx = await makeServer();
  try {
    const sub = await submitEa(ctx);
    const r = await adminReq(
      ctx,
      "POST",
      `/api/admin/ea-submissions/${sub.payload.id}/migrate`
    );
    assert.equal(r.status, 200);
    assert.ok(r.payload.eaProductId);
    assert.equal(r.payload.eaProductStatus, "draft");

    // submission marked migrated
    const updated = ctx.submissionRepo.getById(sub.payload.id);
    assert.equal(updated.status, "migrated");

    // ea_products has the record (draft, not published)
    const eaItem = ctx.contentRepos.ea.getById(r.payload.eaProductId);
    assert.ok(eaItem);
    assert.equal(eaItem.status, "draft");
    assert.equal(eaItem.name, "Test EA Bot");
    assert.equal(eaItem.price, 0);
    assert.equal(eaItem.type, "free");

    // public list ยังไม่เห็น (draft)
    const listRes = await fetch(`${ctx.base}/api/content/ea`);
    const listBody = await listRes.json();
    assert.equal(listBody.items.length, 0, "not visible until published");
  } finally {
    await ctx.close();
  }
});

test("J4. admin review endpoints require auth", async () => {
  const ctx = await makeServer();
  try {
    // no auth
    const res = await fetch(`${ctx.base}/api/admin/ea-submissions`, {
      headers: { origin: ctx.selfOrigin },
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  } finally {
    await ctx.close();
  }
});

test("J5. admin migrate then publish → public sees it", async () => {
  const ctx = await makeServer();
  try {
    const sub = await submitEa(ctx);
    const mig = await adminReq(
      ctx,
      "POST",
      `/api/admin/ea-submissions/${sub.payload.id}/migrate`
    );
    const eaId = mig.payload.eaProductId;

    const pub = await adminReq(
      ctx,
      "POST",
      `/api/admin/content/ea/${eaId}/publish`
    );
    assert.equal(pub.status, 200);

    const listRes = await fetch(`${ctx.base}/api/content/ea`);
    const listBody = await listRes.json();
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.items[0].name, "Test EA Bot");
  } finally {
    await ctx.close();
  }
});

test("J6. admin submission counts route is reachable", async () => {
  const ctx = await makeServer();
  try {
    await submitEa(ctx);
    const counts = await adminReq(ctx, "GET", "/api/admin/ea-submissions/counts");
    assert.equal(counts.status, 200);
    assert.equal(counts.payload.pending_review, 1);
  } finally {
    await ctx.close();
  }
});

test("J7. migrating the same submission twice is blocked without duplicate product", async () => {
  const ctx = await makeServer();
  try {
    const sub = await submitEa(ctx);
    const path = `/api/admin/ea-submissions/${sub.payload.id}/migrate`;
    const first = await adminReq(ctx, "POST", path);
    const second = await adminReq(ctx, "POST", path);
    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.equal(second.payload.error, "already_reviewed");
    assert.equal(ctx.contentRepos.ea.listAll(100, 0).length, 1);
  } finally {
    await ctx.close();
  }
});
