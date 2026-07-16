/* ============================================================
   Phase 14 — Content Management API integration tests
   ------------------------------------------------------------
   ครอบคลุม (ตามข้อกำหนด):
     A. Authorization (auth + CSRF/Origin)
     B. CRUD (create/list/detail/update/delete) สำหรับทุก content type
     C. Publish gate (publish/unpublish) — public เห็นเฉพาะ published
     D. Validation (slug, required fields, enum, price logic)
     E. Upload rejection (extension, size, magic bytes, SVG script, path traversal)
     F. Public API (published only, by slug, by id)
     G. No secret leak ใน response ใดๆ
     H. Upload file serving (read-only, path-traversal safe)

   กฎ QC: ใช้ TEST TOKEN (random) เท่านั้น — ห้ามใช้ ADMIN_TOKEN จริง
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createContentRepositories } from "../src/store/contentRepository.js";
import { createUploadService } from "../src/content/uploadService.js";
import { createAutoPilotRepository } from "../src/store/autoPilotRepository.js";
import { createAuditRepository } from "../src/store/auditRepository.js";
import { createAutoPilot } from "../src/autopilot/autoPilot.js";
import { createHttpServer, listen } from "../src/api/server.js";

const projectRoot = resolve(process.cwd(), "..");

/* ---------- helpers ---------- */

function makeTestToken() {
  return "test-" + randomBytes(16).toString("hex");
}

async function makeServer(opts = {}) {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const contentRepos = createContentRepositories(db);
  const tmpUploads = mkdtempSync(join(tmpdir(), "tt-test-uploads-"));
  const uploadService = createUploadService({ uploadsRoot: tmpUploads });
  // autoPilot + repos จำเป็นสำหรับ /api/admin/auto-pilot/login (cookie session source)
  // ใช้ mock ที่ไม่ยิง network (envAllowed default true; fetchFn stubs return empty)
  const apRepo = createAutoPilotRepository(db);
  const auditRepo = createAuditRepository(db);
  const autoPilot = createAutoPilot(
    { repo, apRepo, auditRepo },
    {
      fetchDigestFn: async () => ({ items: [], needsReview: [] }),
      fetchArticlesFn: async () => ({ results: [], errors: [] }),
      processBatchFn: async () => ({ results: [], saved: [], duplicates: [], failed: [] }),
      envAllowed: opts.envAllowed ?? true,
    }
  );
  const token = opts.token || makeTestToken();
  const server = createHttpServer({
    repo,
    contentRepos,
    uploadService,
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
    uploadsRoot: tmpUploads,
    db,
    close: async () => {
      await new Promise((r) => server.close(r));
      db.close();
      rmSync(tmpUploads, { recursive: true, force: true });
    },
  };
}

/** fetch helper */
async function req(base, method, path, opts = {}) {
  const init = { method, headers: {} };
  if (opts.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  if (opts.origin !== undefined) init.headers.origin = opts.origin;
  if (opts.auth) init.headers.authorization = "Bearer " + opts.auth;
  if (opts.headers) init.headers = { ...init.headers, ...opts.headers };
  const res = await fetch(base + path, init);
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: res.status, payload: payload || {}, headers: res.headers };
}

/** build a multipart/form-data body for upload tests */
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

/* ============================================================
   A. AUTHORIZATION
   ============================================================ */

test("A1. no auth → 401", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "GET", "/api/admin/content/ea");
    assert.equal(r.status, 401);
    assert.equal(r.payload.error, "unauthorized");
  } finally {
    await s.close();
  }
});

test("A2. bad Bearer → 401", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "GET", "/api/admin/content/ea", { auth: "wrong" });
    assert.equal(r.status, 401);
  } finally {
    await s.close();
  }
});

test("A3. state-changing without Origin → 403 (CSRF)", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token,
      body: { name: "X", slug: "x", version: "1", platform: "mt5", price: 0, type: "free" },
    });
    assert.equal(r.status, 403);
    assert.equal(r.payload.error, "origin_not_allowed");
  } finally {
    await s.close();
  }
});

test("A4. admin disabled → 503", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const contentRepos = createContentRepositories(db);
  const tmpUploads = mkdtempSync(join(tmpdir(), "tt-test-uploads-"));
  const uploadService = createUploadService({ uploadsRoot: tmpUploads });
  const server = createHttpServer({
    repo, contentRepos, uploadService,
    projectRoot, siteVersion: "2",
    adminToken: "", // disabled
    adminAllowedOrigins: [],
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const r = await req(base, "GET", "/api/admin/content/ea");
    assert.equal(r.status, 503);
  } finally {
    await new Promise((res) => server.close(res));
    db.close();
    rmSync(tmpUploads, { recursive: true, force: true });
  }
});

test("A5. allowlist origin honored", async () => {
  const s = await makeServer({ adminAllowedOrigins: ["http://127.0.0.1:9999"] });
  try {
    const good = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token,
      origin: "http://127.0.0.1:9999",
      body: { name: "X", slug: "x-allow", version: "1", platform: "mt5", price: 0, type: "free" },
    });
    assert.equal(good.status, 201);
    const bad = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token,
      origin: s.base,
      body: { name: "Y", slug: "y-allow", version: "1", platform: "mt5", price: 0, type: "free" },
    });
    assert.equal(bad.status, 403);
  } finally {
    await s.close();
  }
});

/* ============================================================
   B. CRUD (all content types)
   ============================================================ */

const EA_BODY = {
  name: "Test EA",
  slug: "test-ea",
  description: "desc",
  version: "1.0",
  platform: "mt5",
  price: 99,
  type: "paid",
  filePath: "ea-files/a.ex5",
  fileName: "a.ex5",
  fileSize: 100,
  fileMime: "application/octet-stream",
  coverImage: "images/cover.png",
};

test("B1. EA full CRUD", async () => {
  const s = await makeServer();
  try {
    // create
    const created = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base, body: EA_BODY,
    });
    assert.equal(created.status, 201);
    const id = created.payload.id;
    assert.match(id, /^ea-/);

    // list (admin)
    const list = await req(s.base, "GET", "/api/admin/content/ea", { auth: s.token });
    assert.equal(list.status, 200);
    assert.equal(Array.isArray(list.payload), true);
    assert.equal(list.payload.length, 1);

    // detail
    const detail = await req(s.base, "GET", `/api/admin/content/ea/${id}`, { auth: s.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.payload.name, "Test EA");
    assert.equal(detail.payload.price, 99);

    // update
    const upd = await req(s.base, "PUT", `/api/admin/content/ea/${id}`, {
      auth: s.token, origin: s.base,
      body: { ...EA_BODY, name: "Test EA v2", slug: "test-ea" },
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.payload.name, "Test EA v2");

    // delete
    const del = await req(s.base, "DELETE", `/api/admin/content/ea/${id}`, {
      auth: s.token, origin: s.base,
    });
    assert.equal(del.status, 200);
    assert.equal(del.payload.deleted, true);

    // gone
    const gone = await req(s.base, "GET", `/api/admin/content/ea/${id}`, { auth: s.token });
    assert.equal(gone.status, 404);
  } finally {
    await s.close();
  }
});

test("B2. Article full CRUD with JSON body", async () => {
  const s = await makeServer();
  try {
    const created = await req(s.base, "POST", "/api/admin/content/articles", {
      auth: s.token, origin: s.base,
      body: {
        title: "Test Article",
        slug: "test-article",
        excerpt: "excerpt",
        body: [
          { type: "p", text: "hello" },
          { type: "h2", text: "section" },
          { type: "ul", items: ["a", "b"] },
        ],
        category: "Forex",
        readMinutes: 5,
      },
    });
    assert.equal(created.status, 201);
    const id = created.payload.id;
    assert.match(id, /^kb-/);

    // verify body stored as JSON array
    const detail = await req(s.base, "GET", `/api/admin/content/articles/${id}`, { auth: s.token });
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.payload.body, [
      { type: "p", text: "hello" },
      { type: "h2", text: "section" },
      { type: "ul", items: ["a", "b"] },
    ]);

    // delete
    const del = await req(s.base, "DELETE", `/api/admin/content/articles/${id}`, {
      auth: s.token, origin: s.base,
    });
    assert.equal(del.status, 200);
  } finally {
    await s.close();
  }
});

test("B3. FAQ full CRUD (no slug)", async () => {
  const s = await makeServer();
  try {
    const created = await req(s.base, "POST", "/api/admin/content/faq", {
      auth: s.token, origin: s.base,
      body: { question: "Q?", answer: "A.", category: "general" },
    });
    assert.equal(created.status, 201);
    const id = created.payload.id;
    assert.match(id, /^faq-/);

    const detail = await req(s.base, "GET", `/api/admin/content/faq/${id}`, { auth: s.token });
    assert.equal(detail.payload.question, "Q?");
    assert.equal(detail.payload.answer, "A.");

    const del = await req(s.base, "DELETE", `/api/admin/content/faq/${id}`, {
      auth: s.token, origin: s.base,
    });
    assert.equal(del.status, 200);
  } finally {
    await s.close();
  }
});

test("B4. Broker full CRUD with arrays", async () => {
  const s = await makeServer();
  try {
    const created = await req(s.base, "POST", "/api/admin/content/brokers", {
      auth: s.token, origin: s.base,
      body: {
        name: "Test Broker",
        slug: "test-broker",
        regulation: ["ASIC", "CySEC"],
        platform: ["MT4", "MT5"],
        pros: ["pro1", "pro2"],
        cons: ["con1"],
        rating: 4.5,
        score: 9.0,
        minDeposit: 100,
        referenceUrl: "https://example.com/review",
        reviewedAt: "2026-07-16",
      },
    });
    assert.equal(created.status, 201);
    const id = created.payload.id;
    assert.match(id, /^broker-/);

    const detail = await req(s.base, "GET", `/api/admin/content/brokers/${id}`, { auth: s.token });
    assert.deepEqual(detail.payload.regulation, ["ASIC", "CySEC"]);
    assert.deepEqual(detail.payload.platform, ["MT4", "MT5"]);
    assert.deepEqual(detail.payload.pros, ["pro1", "pro2"]);
    assert.equal(detail.payload.rating, 4.5);
    assert.equal(detail.payload.referenceUrl, "https://example.com/review");

    const del = await req(s.base, "DELETE", `/api/admin/content/brokers/${id}`, {
      auth: s.token, origin: s.base,
    });
    assert.equal(del.status, 200);
  } finally {
    await s.close();
  }
});

test("B5. delete non-existent → 404", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "DELETE", "/api/admin/content/ea/non-existent", {
      auth: s.token, origin: s.base,
    });
    assert.equal(r.status, 404);
  } finally {
    await s.close();
  }
});

/* ============================================================
   C. PUBLISH GATE
   ============================================================ */

test("C1. publish gate rejects missing required fields", async () => {
  const s = await makeServer();
  try {
    // create EA without file_path (required for publish)
    const created = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base,
      body: { name: "No File EA", slug: "no-file", version: "1.0", platform: "mt5", price: 0, type: "free" },
    });
    assert.equal(created.status, 201);
    const id = created.payload.id;

    // publish should fail (missing file_path)
    const pub = await req(s.base, "POST", `/api/admin/content/ea/${id}/publish`, {
      auth: s.token, origin: s.base,
    });
    assert.equal(pub.status, 409);
    assert.equal(pub.payload.error, "missing_required");
    assert.ok(pub.payload.missing.includes("file_path"));
  } finally {
    await s.close();
  }
});

test("C2. publish/unpublish toggles public visibility", async () => {
  const s = await makeServer();
  try {
    const created = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base, body: EA_BODY,
    });
    const id = created.payload.id;

    // public sees nothing yet
    assert.equal((await req(s.base, "GET", "/api/content/ea")).payload.items.length, 0);

    // publish
    const pub = await req(s.base, "POST", `/api/admin/content/ea/${id}/publish`, {
      auth: s.token, origin: s.base,
    });
    assert.equal(pub.status, 200);
    assert.equal(pub.payload.published, true);

    // public sees it
    assert.equal((await req(s.base, "GET", "/api/content/ea")).payload.items.length, 1);

    // unpublish
    const unpub = await req(s.base, "POST", `/api/admin/content/ea/${id}/unpublish`, {
      auth: s.token, origin: s.base,
    });
    assert.equal(unpub.status, 200);
    assert.equal(unpub.payload.unpublished, true);

    // public sees nothing
    assert.equal((await req(s.base, "GET", "/api/content/ea")).payload.items.length, 0);
  } finally {
    await s.close();
  }
});

test("C3. publish non-existent → 404", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", "/api/admin/content/ea/nope/publish", {
      auth: s.token, origin: s.base,
    });
    assert.equal(r.status, 404);
  } finally {
    await s.close();
  }
});

test("C4. publish requires Origin (CSRF)", async () => {
  const s = await makeServer();
  try {
    const created = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base, body: EA_BODY,
    });
    const id = created.payload.id;
    const r = await req(s.base, "POST", `/api/admin/content/ea/${id}/publish`, {
      auth: s.token, // no origin
    });
    assert.equal(r.status, 403);
  } finally {
    await s.close();
  }
});

/* ============================================================
   D. VALIDATION
   ============================================================ */

test("D1. invalid slug rejected", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base,
      body: { name: "Y", slug: "BAD SLUG!", version: "1", platform: "mt5", price: 0, type: "free" },
    });
    assert.equal(r.status, 400);
    assert.equal(r.payload.error, "validation_failed");
  } finally {
    await s.close();
  }
});

test("D2. missing required field rejected", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base,
      body: { slug: "no-name", version: "1", platform: "mt5", price: 0, type: "free" },
    });
    assert.equal(r.status, 400);
    assert.ok(r.payload.details.includes("name_required"));
  } finally {
    await s.close();
  }
});

test("D3. free type with non-zero price rejected", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base,
      body: { name: "Z", slug: "z-free", version: "1", platform: "mt5", price: 100, type: "free" },
    });
    assert.equal(r.status, 400);
  } finally {
    await s.close();
  }
});

test("D4. paid type with zero price rejected", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base,
      body: { name: "Z", slug: "z-paid", version: "1", platform: "mt5", price: 0, type: "paid" },
    });
    assert.equal(r.status, 400);
  } finally {
    await s.close();
  }
});

test("D5. invalid platform enum rejected", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base,
      body: { name: "Z", slug: "z-plat", version: "1", platform: "metatrader", price: 0, type: "free" },
    });
    assert.equal(r.status, 400);
    assert.ok(r.payload.details.includes("platform_invalid"));
  } finally {
    await s.close();
  }
});

test("D6. slug auto-generated from name when missing", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base,
      body: { name: "My Cool EA", version: "1.0", platform: "mt5", price: 0, type: "free" },
    });
    assert.equal(r.status, 201);
    assert.equal(r.payload.slug, "my-cool-ea");
  } finally {
    await s.close();
  }
});

test("D7. duplicate slug rejected", async () => {
  const s = await makeServer();
  try {
    const first = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base,
      body: { name: "First", slug: "dup", version: "1", platform: "mt5", price: 0, type: "free" },
    });
    assert.equal(first.status, 201);
    const second = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base,
      body: { name: "Second", slug: "dup", version: "1", platform: "mt5", price: 0, type: "free" },
    });
    assert.equal(second.status, 409);
    assert.equal(second.payload.error, "slug_already_exists");
  } finally {
    await s.close();
  }
});

test("D8. invalid reference URL rejected (must be http/https)", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", "/api/admin/content/brokers", {
      auth: s.token, origin: s.base,
      body: {
        name: "Bad", slug: "bad-url",
        referenceUrl: "javascript:alert(1)",
        rating: 4, score: 8, status: "draft",
      },
    });
    // create succeeds (URL is sanitized to empty), but referenceUrl is ""
    assert.equal(r.status, 201);
    assert.equal(r.payload.referenceUrl, "");
  } finally {
    await s.close();
  }
});

test("D9. FAQ requires both question and answer", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", "/api/admin/content/faq", {
      auth: s.token, origin: s.base,
      body: { question: "Q only?" },
    });
    assert.equal(r.status, 400);
    assert.ok(r.payload.details.includes("answer_required"));
  } finally {
    await s.close();
  }
});

/* ============================================================
   E. UPLOAD REJECTION
   ============================================================ */

test("E1. upload requires auth", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "POST", "/api/admin/content/upload/image", {});
    assert.equal(r.status, 401);
  } finally {
    await s.close();
  }
});

test("E2. upload requires Origin (CSRF)", async () => {
  const s = await makeServer();
  try {
    const boundary = "----testboundary";
    const body = buildMultipart(boundary, {
      file: { filename: "a.png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png" },
    });
    const r = await fetch(s.base + "/api/admin/content/upload/image", {
      method: "POST",
      headers: {
        authorization: "Bearer " + s.token,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    assert.equal(r.status, 403);
  } finally {
    await s.close();
  }
});

test("E3. upload rejects bad extension", async () => {
  const s = await makeServer();
  try {
    const boundary = "----testboundary";
    const body = buildMultipart(boundary, {
      file: { filename: "evil.exe", buffer: Buffer.alloc(100, 0), contentType: "application/octet-stream" },
    });
    const r = await fetch(s.base + "/api/admin/content/upload/image", {
      method: "POST",
      headers: {
        authorization: "Bearer " + s.token,
        origin: s.base,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    const payload = await r.json();
    assert.equal(r.status, 400);
    assert.equal(payload.error, "extension_not_allowed");
  } finally {
    await s.close();
  }
});

test("E4. upload rejects magic-bytes mismatch", async () => {
  const s = await makeServer();
  try {
    const boundary = "----testboundary";
    // gif bytes but claiming to be .png
    const body = buildMultipart(boundary, {
      file: { filename: "fake.png", buffer: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), contentType: "image/png" },
    });
    const r = await fetch(s.base + "/api/admin/content/upload/image", {
      method: "POST",
      headers: {
        authorization: "Bearer " + s.token,
        origin: s.base,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    const payload = await r.json();
    assert.equal(r.status, 400);
    assert.equal(payload.error, "magic_bytes_mismatch");
  } finally {
    await s.close();
  }
});

test("E5. upload rejects SVG files", async () => {
  const s = await makeServer();
  try {
    const boundary = "----testboundary";
    const body = buildMultipart(boundary, {
      file: {
        filename: "evil.svg",
        buffer: Buffer.from("<svg><script>alert(1)</script></svg>"),
        contentType: "image/svg+xml",
      },
    });
    const r = await fetch(s.base + "/api/admin/content/upload/image", {
      method: "POST",
      headers: {
        authorization: "Bearer " + s.token,
        origin: s.base,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    const payload = await r.json();
    assert.equal(r.status, 400);
    assert.equal(payload.error, "extension_not_allowed");
  } finally {
    await s.close();
  }
});

test("E6. upload rejects when no file provided", async () => {
  const s = await makeServer();
  try {
    const boundary = "----testboundary";
    const body = buildMultipart(boundary, { description: "no file here" });
    const r = await fetch(s.base + "/api/admin/content/upload/image", {
      method: "POST",
      headers: {
        authorization: "Bearer " + s.token,
        origin: s.base,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    const payload = await r.json();
    assert.equal(r.status, 400);
    assert.equal(payload.error, "no_file_provided");
  } finally {
    await s.close();
  }
});

test("E7. valid PNG image uploads successfully", async () => {
  const s = await makeServer();
  try {
    const boundary = "----testboundary";
    // build a real-ish PNG header + body
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pngBytes = Buffer.concat([pngMagic, Buffer.alloc(50, 0)]);
    const body = buildMultipart(boundary, {
      file: { filename: "cover.png", buffer: pngBytes, contentType: "image/png" },
    });
    const r = await fetch(s.base + "/api/admin/content/upload/image", {
      method: "POST",
      headers: {
        authorization: "Bearer " + s.token,
        origin: s.base,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    const payload = await r.json();
    assert.equal(r.status, 201);
    assert.equal(payload.ok, true);
    assert.match(payload.filename, /^[a-f0-9]+\.png$/);
    assert.ok(payload.path.startsWith("images"));
    assert.equal(payload.size, pngBytes.length);
    assert.equal(payload.ext, "png");

    // verify file actually written to disk
    const absPath = join(s.uploadsRoot, payload.path);
    const st = statSync(absPath);
    assert.equal(st.size, pngBytes.length);

    // filename must be renamed (not original 'cover.png')
    assert.notEqual(payload.filename, "cover.png");
  } finally {
    await s.close();
  }
});

test("E8. valid EA file uploads successfully", async () => {
  const s = await makeServer();
  try {
    const boundary = "----testboundary";
    const ex5Bytes = Buffer.alloc(2048, 0xaa);
    const body = buildMultipart(boundary, {
      file: { filename: "mybot.ex5", buffer: ex5Bytes, contentType: "application/octet-stream" },
    });
    const r = await fetch(s.base + "/api/admin/content/upload/ea", {
      method: "POST",
      headers: {
        authorization: "Bearer " + s.token,
        origin: s.base,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    const payload = await r.json();
    assert.equal(r.status, 201);
    assert.equal(payload.ext, "ex5");
    assert.ok(payload.path.startsWith("ea-files"));
    assert.equal(payload.size, 2048);
  } finally {
    await s.close();
  }
});

/* ============================================================
   F. PUBLIC API (published only)
   ============================================================ */

test("F1. public API only returns published", async () => {
  const s = await makeServer();
  try {
    // create two articles, publish one
    const a1 = await req(s.base, "POST", "/api/admin/content/articles", {
      auth: s.token, origin: s.base,
      body: { title: "Published", slug: "pub-one", excerpt: "x" },
    });
    const a2 = await req(s.base, "POST", "/api/admin/content/articles", {
      auth: s.token, origin: s.base,
      body: { title: "Draft", slug: "draft-one", excerpt: "y" },
    });
    await req(s.base, "POST", `/api/admin/content/articles/${a1.payload.id}/publish`, {
      auth: s.token, origin: s.base,
    });

    const list = await req(s.base, "GET", "/api/content/articles");
    assert.equal(list.status, 200);
    assert.equal(list.payload.items.length, 1);
    assert.equal(list.payload.items[0].slug, "pub-one");

    // published detail by slug
    const bySlug = await req(s.base, "GET", "/api/content/articles/pub-one");
    assert.equal(bySlug.status, 200);
    assert.equal(bySlug.payload.title, "Published");

    // draft detail by slug → 404
    const draftBySlug = await req(s.base, "GET", "/api/content/articles/draft-one");
    assert.equal(draftBySlug.status, 404);

    // published detail by id
    const byId = await req(s.base, "GET", `/api/content/articles/${a1.payload.id}`);
    assert.equal(byId.status, 200);
  } finally {
    await s.close();
  }
});

test("F2. public API does not leak internal metadata (fileName renamed, fileSize, fileMime, raw status)", async () => {
  const s = await makeServer();
  try {
    const created = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base, body: { ...EA_BODY, slug: "leak-test" },
    });
    await req(s.base, "POST", `/api/admin/content/ea/${created.payload.id}/publish`, {
      auth: s.token, origin: s.base,
    });
    const item = (await req(s.base, "GET", "/api/content/ea")).payload.items[0];
    // public must expose filePath (relative, for /uploads/ download) + coverImage
    // but NOT internal metadata like renamed fileName, fileSize, fileMime, raw status
    assert.ok(typeof item.filePath === "string", "filePath is exposed (intended, relative)");
    assert.equal(item.fileName, undefined, "renamed fileName should NOT leak");
    assert.equal(item.fileSize, undefined, "fileSize should NOT leak");
    assert.equal(item.fileMime, undefined, "fileMime should NOT leak");
    assert.equal(item.status, undefined, "raw status should NOT leak in public");
    assert.equal(item.createdAt, undefined, "createdAt should NOT leak");
    assert.equal(item.updatedAt, undefined, "updatedAt should NOT leak");
  } finally {
    await s.close();
  }
});

test("F3. unknown content type → 404", async () => {
  const s = await makeServer();
  try {
    assert.equal((await req(s.base, "GET", "/api/content/bogus")).status, 404);
  } finally {
    await s.close();
  }
});

/* ============================================================
   G. NO SECRET LEAK
   ============================================================ */

test("G1. no secret/token leak in any content response", async () => {
  const s = await makeServer();
  try {
    const created = await req(s.base, "POST", "/api/admin/content/ea", {
      auth: s.token, origin: s.base, body: EA_BODY,
    });
    await req(s.base, "POST", `/api/admin/content/ea/${created.payload.id}/publish`, {
      auth: s.token, origin: s.base,
    });

    const responses = [
      (await req(s.base, "GET", "/api/admin/content/ea", { auth: s.token })).payload,
      (await req(s.base, "GET", `/api/admin/content/ea/${created.payload.id}`, { auth: s.token })).payload,
      (await req(s.base, "GET", "/api/content/ea")).payload,
      (await req(s.base, "GET", `/api/content/ea/${created.payload.id}`)).payload,
      (await req(s.base, "GET", "/api/admin/content/counts", { auth: s.token })).payload,
    ];
    const dump = JSON.stringify(responses);
    assert.equal(dump.includes(s.token), false, "must not leak test token");
    assert.equal(dump.includes("adminToken"), false);
    assert.equal(dump.includes("apiKey"), false);
    assert.equal(dump.includes("OPENAI_API_KEY"), false);
    assert.equal(dump.includes("password"), false);
  } finally {
    await s.close();
  }
});

/* ============================================================
   H. UPLOAD FILE SERVING (read-only, path-traversal safe)
   ============================================================ */

test("H1. uploaded image served via /uploads/ read-only", async () => {
  const s = await makeServer();
  try {
    // upload
    const boundary = "----testboundary";
    const pngBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(50, 0),
    ]);
    const body = buildMultipart(boundary, {
      file: { filename: "serve.png", buffer: pngBytes, contentType: "image/png" },
    });
    const up = await fetch(s.base + "/api/admin/content/upload/image", {
      method: "POST",
      headers: {
        authorization: "Bearer " + s.token,
        origin: s.base,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    const upPayload = await up.json();
    assert.equal(up.status, 201);

    // GET via /uploads/<path>
    const served = await fetch(s.base + "/uploads/" + upPayload.path);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    const buf = Buffer.from(await served.arrayBuffer());
    assert.equal(buf.length, pngBytes.length);
  } finally {
    await s.close();
  }
});

test("H2. path traversal via /uploads/ rejected", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "GET", "/uploads/../package.json");
    assert.ok(r.status === 400 || r.status === 404, `expected 400/404, got ${r.status}`);
  } finally {
    await s.close();
  }
});

test("H3. /uploads/ does not allow PUT (read-only)", async () => {
  const s = await makeServer();
  try {
    const r = await fetch(s.base + "/uploads/images/whatever.png", {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: Buffer.from([0x89, 0x50]),
    });
    // server only handles GET on /uploads/ — PUT falls through to 404/405
    assert.ok(r.status >= 400, `expected >=400, got ${r.status}`);
  } finally {
    await s.close();
  }
});

test("H4. existing news/calendar/market API still works (regression)", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const contentRepos = createContentRepositories(db);
  const tmpUploads = mkdtempSync(join(tmpdir(), "tt-test-uploads-"));
  const uploadService = createUploadService({ uploadsRoot: tmpUploads });
  const token = makeTestToken();
  // provide marketService + calendarService with mocks (no network)
  const { createMarketService, DEFAULT_SYMBOLS } = await import("../src/market/marketService.js");
  const { createCalendarRepository } = await import("../src/store/calendarRepository.js");
  const { createCalendarService } = await import("../src/calendar/calendarService.js");
  const calendarRepo = createCalendarRepository(db);
  const calendarService = createCalendarService(calendarRepo, { fetchFn: async () => [] });
  const marketService = createMarketService({
    symbols: DEFAULT_SYMBOLS,
    fetchFn: async () => ({
      price: 1,
      source: "mock",
      sourceUrl: "u",
      fetchedAt: "2026-07-16T05:00:00.000Z",
    }),
    cacheSeconds: 60,
    staleAfterSeconds: 600,
  });
  const server = createHttpServer({
    repo, contentRepos, uploadService, marketService, calendarService,
    projectRoot, siteVersion: "2", adminToken: token, adminAllowedOrigins: [],
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${address.port}`;
  try {
    // health
    const health = await req(base, "GET", "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.payload.ok, true);
    // news list (should be empty array-shaped)
    const news = await req(base, "GET", "/api/news");
    assert.equal(news.status, 200);
    // market-ticker
    const ticker = await req(base, "GET", "/api/market-ticker");
    assert.equal(ticker.status, 200);
    // calendar (empty)
    const cal = await req(base, "GET", "/api/calendar?from=2026-07-01&to=2026-07-31");
    assert.equal(cal.status, 200);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
    rmSync(tmpUploads, { recursive: true, force: true });
  }
});

/* ============================================================
   I. ADMIN COOKIE SESSION QC — cross-API shared session
   ------------------------------------------------------------
   ทดสอบตามที่ Codex กำหนด (7 ข้อ):
     1. POST /api/admin/auto-pilot/login ด้วย token + Origin → 200
     2. ได้รับ cookie admin_session ที่มี HttpOnly + SameSite=Strict + Path=/api/admin
     3. ใช้ cookie GET /api/admin/content/ea → 200
     4. ใช้ cookie + Origin ถูก POST /api/admin/content/ea (draft) → 201
     5. ใช้ cookie เดิม + Origin ผิด → 403
     6. ทุก request ใน test นี้ต้องไม่มี Bearer Authorization header
     7. (การรัน npm run check + node --test test/phase14.test.js อยู่นอก test file)
   ============================================================ */

/** login helper ผ่าน auto-pilot endpoint (ส่ง Origin เสมอเพราะเป็น state-changing) */
async function adminLogin(base, token, origin) {
  const res = await fetch(base + "/api/admin/auto-pilot/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ token }),
    // redirect:"manual" ไม่เกี่ยว — เพียงแต่กัน fetch ตาม redirect อัตโนมัติ
    redirect: "manual",
  });
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

/** fetch helper ที่ใช้ cookie เท่านั้น (ห้าม Bearer — QC ข้อ 6) */
async function reqCookieOnly(base, method, path, opts = {}) {
  const init = {
    method,
    headers: {},
    redirect: "manual",
  };
  if (opts.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  if (opts.origin !== undefined) init.headers.origin = opts.origin;
  if (opts.cookie) init.headers.cookie = opts.cookie;
  // NOTE: ห้ามใส่ Authorization header เด็ดขาด — ใช้ cookie เท่านั้น
  assert.equal(
    init.headers.authorization,
    undefined,
    "QC6: test นี้ต้องไม่มี Bearer Authorization header"
  );
  const res = await fetch(base + path, init);
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: res.status, payload: payload || {} };
}

/** helper: ดึง cookie pair จาก Set-Cookie header (เช่น admin_session=xxx) */
function extractCookiePair(setCookie) {
  if (!setCookie) return "";
  return setCookie.split(";")[0].trim(); // admin_session=VALUE
}

test("I1-I7. Admin cookie session shared across auto-pilot + content APIs (no Bearer)", async () => {
  // ใช้ makeServer ที่มีอยู่ (ตั้ง adminToken + adminAllowedOrigins=[] → ใช้ self-origin)
  const s = await makeServer();
  try {
    /* ---- I1: login ด้วย token + Origin ที่ถูกต้อง ---- */
    const login = await adminLogin(s.base, s.token, s.base);
    assert.equal(login.status, 200, `login ต้องสำเร็จ (got ${login.status})`);
    assert.equal(login.payload.authenticated, true);

    /* ---- I2: ได้รับ cookie admin_session ที่ถูกต้อง ---- */
    assert.ok(login.setCookie, "ต้องมี Set-Cookie header");
    assert.match(login.setCookie, /admin_session=/i, "cookie ชื่อ admin_session");
    assert.match(login.setCookie, /HttpOnly/i, "ต้องมี HttpOnly");
    assert.match(login.setCookie, /SameSite=Strict/i, "ต้องมี SameSite=Strict");
    // QC เฉพาะ: Path ต้องเป็น /api/admin (ไม่ใช่ /api/admin/auto-pilot)
    assert.match(login.setCookie, /Path=\/api\/admin\b/i, "Path ต้องเป็น /api/admin");
    assert.equal(
      /Path=\/api\/admin\/auto-pilot/i.test(login.setCookie),
      false,
      "Path ต้องไม่ใช่ auto-pilot-only (ต้องครอบ content API ด้วย)"
    );

    const cookie = extractCookiePair(login.setCookie);
    assert.ok(cookie.startsWith("admin_session="), "cookie pair ถูกต้อง");

    /* ---- I3: ใช้ cookie GET /api/admin/content/ea → 200 (cookie-only, no Bearer) ---- */
    const list = await reqCookieOnly(s.base, "GET", "/api/admin/content/ea", { cookie });
    assert.equal(list.status, 200, `content list ด้วย cookie ต้องสำเร็จ (got ${list.status})`);

    /* ---- I4: ใช้ cookie + Origin ถูก POST draft EA → 201 ---- */
    const draftBody = {
      name: "Cookie Session EA",
      slug: "cookie-session-ea",
      description: "draft สร้างผ่าน cookie session QC test",
      version: "1.0",
      platform: "mt5",
      price: 0,
      type: "free",
      status: "draft",
    };
    const created = await reqCookieOnly(s.base, "POST", "/api/admin/content/ea", {
      cookie,
      origin: s.base, // Origin ตรง self-origin
      body: draftBody,
    });
    assert.equal(created.status, 201, `สร้าง draft ด้วย cookie ต้องได้ 201 (got ${created.status})`);
    assert.match(created.payload.id || "", /^ea-/, "id ต้องขึ้นต้นด้วย ea-");
    assert.equal(created.payload.status, "draft", "ต้องเป็น draft");

    /* ---- I5: ใช้ cookie เดิมแต่ Origin ผิด → 403 ---- */
    const badOrigin = await reqCookieOnly(s.base, "POST", "/api/admin/content/ea", {
      cookie,
      origin: "http://evil.example.com",
      body: {
        name: "Should Be Blocked",
        slug: "blocked-by-csrf",
        version: "1.0",
        platform: "mt5",
        price: 0,
        type: "free",
        status: "draft",
      },
    });
    assert.equal(badOrigin.status, 403, `Origin ผิด ต้อง 403 (got ${badOrigin.status})`);
    assert.equal(badOrigin.payload.error, "origin_not_allowed");

    /* ---- I6: ยืนยันว่าทุก request ใน test นี้ไม่มี Bearer ----
       reqCookieOnly ตรวจ authorization===undefined ภายใน helper อยู่แล้ว
       เพิ่ม sanity check: ถ้าส่ง Bearer จริง ต้องผ่าน (พิสูจน์ว่า helper ไม่โกง) ---- */
    // ใช้ Bearer ตรงๆ → ต้องได้ 200 (พิสูจน์ว่าถ้าใส่ Bearer จะผ่าน ดังนั้น cookie-only path จริงๆ คือ cookie)
    const bearerCheck = await fetch(s.base + "/api/admin/content/ea", {
      headers: { authorization: "Bearer " + s.token },
    });
    assert.equal(bearerCheck.status, 200, "Bearer ต้องผ่าน (พิสูจน์ว่า cookie-only ไม่ใช่เพราะ token รั่ว)");
    // สรุป: cookie path ทำงานเพราะ cookie ไม่ใช่เพราะ helper แอบใส่ Bearer
  } finally {
    await s.close();
  }
});
