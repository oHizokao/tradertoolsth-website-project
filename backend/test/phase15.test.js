/* ============================================================
   Phase 15 — Community Forum tests
   ------------------------------------------------------------
   ครอบคลุม (ตามข้อกำหนด):
     A. Authorization (owner-only edit/delete; auth_required สำหรับโพสต์)
     B. Pagination (limit/offset/total/hasMore)
     C. XSS sanitization (script tags, control chars, HTML ไม่รั่ว)
     D. Report flow (topic + post, แจ้งได้, ไม่ crash)
     E. Rate limit (burst exhausted → 429 + retry-after)
     F. Upload validation (extension, magic bytes, executable ปฏิเสธ)
     G. Path traversal (attachments endpoint)
     H. Search + sort + categories
     I. Guest identity (anon token, resolve, no leak)

   ใช้ in-memory DB + real HTTP (createHttpServer + listen)
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createForumService } from "../src/forum/forumService.js";
import { createHttpServer, listen } from "../src/api/server.js";
import {
  validateUpload,
  sanitizeFileName,
  sanitizeBody,
  sanitizeSingleLine,
} from "../src/forum/sanitize.js";

const projectRoot = resolve(process.cwd(), "..");

/* ---------- helpers ---------- */
async function makeServer({ rateLimiter, uploadStore, now } = {}) {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const tmpUploads = mkdtempSync(join(tmpdir(), "tt-forum-test-"));
  const finalConfig = {
    rateLimitSeconds: 1,
    rateLimitBurst: 100, // หลวมใน test ส่วนใหญ่ — rate-limit test ใช้ rateLimiter เฉพาะ
    uploadDir: tmpUploads,
    uploadMaxBytes: 1024,
    uploadMaxFiles: 4,
  };
  const forumService = createForumService({
    db,
    config: finalConfig,
    rateLimiter,
    uploadStore,
    now,
  });
  const server = createHttpServer({
    repo,
    forumService,
    projectRoot,
    siteVersion: "2",
    adminToken: "",
    // adminAllowedOrigins ว่าง = ใช้ self-origin (host ของ req เอง)
    // test จะส่ง origin header ตรงกับ selfOrigin ที่คืนมา
    adminAllowedOrigins: [],
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  const selfOrigin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    base: `http://127.0.0.1:${address.port}`,
    selfOrigin,
    forumService,
    uploadsRoot: tmpUploads,
    close: async () => {
      await new Promise((r) => server.close(r));
      db.close();
      try { rmSync(tmpUploads, { recursive: true, force: true }); } catch {}
    },
  };
}

/** headers พื้นฐานที่ใช้ทุก state-changing request (CSRF/Origin ต้องตรง self-origin) */
function h(ctx, extra = {}) {
  return { "content-type": "application/json", origin: ctx.selfOrigin, ...extra };
}

/** สร้าง guest profile ผ่าน API และคืน { anonToken, author } */
async function createGuest(ctx, displayName = "Tester") {
  const res = await fetch(`${ctx.base}/api/forum/auth/guest`, {
    method: "POST",
    headers: h(ctx),
    body: JSON.stringify({ displayName }),
  });
  return await res.json();
}

async function createTopic(ctx, anonToken, { categorySlug = "general", title = "Hi", body = "Body" } = {}) {
  const res = await fetch(`${ctx.base}/api/forum/topics`, {
    method: "POST",
    headers: h(ctx, { "x-forum-token": anonToken }),
    body: JSON.stringify({ categorySlug, title, body }),
  });
  return { status: res.status, body: await res.json() };
}

async function reply(ctx, anonToken, topicId, body = "Reply") {
  const res = await fetch(`${ctx.base}/api/forum/topics/${topicId}/posts`, {
    method: "POST",
    headers: h(ctx, { "x-forum-token": anonToken }),
    body: JSON.stringify({ body }),
  });
  return { status: res.status, body: await res.json() };
}

/* ============================================================
   A. Authorization
   ============================================================ */

test("forum: create topic without token returns 401", async () => {
  const ctx = await makeServer();
  const res = await fetch(`${ctx.base}/api/forum/topics`, {
    method: "POST",
    headers: h(ctx),
    body: JSON.stringify({ categorySlug: "general", title: "T", body: "B" }),
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "auth_required");
  await ctx.close();
});

test("forum: owner can edit own topic; non-owner cannot", async () => {
  const ctx = await makeServer();
  const owner = await createGuest(ctx, "Owner");
  const other = await createGuest(ctx, "Other");
  const created = await createTopic(ctx, owner.anonToken, { title: "Orig", body: "Orig body" });
  const topicId = created.body.id;

  // owner edit OK
  const editOk = await fetch(`${ctx.base}/api/forum/topics/${topicId}`, {
    method: "PUT",
    headers: h(ctx, { "x-forum-token": owner.anonToken }),
    body: JSON.stringify({ title: "Edited by owner" }),
  });
  assert.equal(editOk.status, 200);
  assert.equal((await editOk.json()).title, "Edited by owner");

  // non-owner edit → 403
  const editBad = await fetch(`${ctx.base}/api/forum/topics/${topicId}`, {
    method: "PUT",
    headers: h(ctx, { "x-forum-token": other.anonToken }),
    body: JSON.stringify({ title: "Hacked" }),
  });
  assert.equal(editBad.status, 403);
  assert.equal((await editBad.json()).error, "not_owner");

  await ctx.close();
});

test("forum: owner can delete own post; non-owner cannot", async () => {
  const ctx = await makeServer();
  const owner = await createGuest(ctx, "Owner");
  const other = await createGuest(ctx, "Other");
  const created = await createTopic(ctx, owner.anonToken, { title: "T", body: "B" });
  const topicId = created.body.id;

  const r = await reply(ctx, owner.anonToken, topicId, "Owner reply");
  const postId = r.body.id;

  // non-owner delete → 403
  const delBad = await fetch(`${ctx.base}/api/forum/posts/${postId}`, {
    method: "DELETE",
    headers: h(ctx, { "x-forum-token": other.anonToken }),
  });
  assert.equal(delBad.status, 403);
  assert.equal((await delBad.json()).error, "not_owner");

  // owner delete → 200
  const delOk = await fetch(`${ctx.base}/api/forum/posts/${postId}`, {
    method: "DELETE",
    headers: h(ctx, { "x-forum-token": owner.anonToken }),
  });
  assert.equal(delOk.status, 200);
  assert.equal((await delOk.json()).ok, true);

  await ctx.close();
});

test("forum: state-changing without Origin header → 403 (CSRF)", async () => {
  const ctx = await makeServer();
  // สังเกต: ไม่ส่ง origin header
  const res = await fetch(`${ctx.base}/api/forum/auth/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "X" }),
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "origin_not_allowed");
  await ctx.close();
});

test("forum: owner can delete own topic (soft delete); detail becomes 404", async () => {
  const ctx = await makeServer();
  const owner = await createGuest(ctx, "Owner");
  const created = await createTopic(ctx, owner.anonToken, { title: "T", body: "B" });
  const topicId = created.body.id;

  const delOk = await fetch(`${ctx.base}/api/forum/topics/${topicId}`, {
    method: "DELETE",
    headers: h(ctx, { "x-forum-token": owner.anonToken }),
  });
  assert.equal(delOk.status, 200);

  const detail = await fetch(`${ctx.base}/api/forum/topics/${topicId}`);
  assert.equal(detail.status, 404);
  await ctx.close();
});

/* ============================================================
   B. Pagination
   ============================================================ */

test("forum: topics pagination returns correct total/hasMore", async () => {
  const ctx = await makeServer();
  const guest = await createGuest(ctx, "Pager");
  for (let i = 0; i < 5; i++) {
    await createTopic(ctx, guest.anonToken, { title: `T${i}`, body: `B${i}` });
  }
  const p1 = await fetch(`${ctx.base}/api/forum/topics?limit=2&offset=0`).then((r) => r.json());
  assert.equal(p1.items.length, 2);
  assert.equal(p1.total, 5);
  assert.equal(p1.hasMore, true);

  const p2 = await fetch(`${ctx.base}/api/forum/topics?limit=2&offset=4`).then((r) => r.json());
  assert.equal(p2.items.length, 1);
  assert.equal(p2.total, 5);
  assert.equal(p2.hasMore, false);
  await ctx.close();
});

test("forum: posts pagination within a topic", async () => {
  const ctx = await makeServer();
  const guest = await createGuest(ctx, "Replier");
  const created = await createTopic(ctx, guest.anonToken, { title: "T", body: "B" });
  const topicId = created.body.id;
  for (let i = 0; i < 3; i++) {
    await reply(ctx, guest.anonToken, topicId, `R${i}`);
  }
  const page = await fetch(`${ctx.base}/api/forum/topics/${topicId}/posts?limit=2&offset=1`).then((r) => r.json());
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].floor, 2);
  assert.equal(page.items[1].floor, 3);
  await ctx.close();
});

/* ============================================================
   C. XSS sanitization
   ============================================================ */

test("forum: XSS payload in title/body is sanitized (no control chars stored)", async () => {
  const ctx = await makeServer();
  const guest = await createGuest(ctx, "XSS");
  const xssTitle = "Hello<script>alert('xss')</script>\u0000evil";
  const xssBody = "Body<img src=x onerror=alert(1)>\u0001newline\n\n\n\n\n\nend";
  const created = await createTopic(ctx, guest.anonToken, { title: xssTitle, body: xssBody });
  assert.equal(created.status, 201);
  const stored = created.body;

  // control chars (null, SOH) ถูก strip
  assert.ok(!stored.title.includes("\u0000"), "null byte must be stripped");
  assert.ok(!stored.body.includes("\u0001"), "SOH must be stripped");
  // newline ซ้อนถูกลดเหลือ ≤3
  assert.ok(!stored.body.match(/\n{4,}/), "consecutive newlines capped");

  // ดึง detail กลับมาตรวจอีกที
  const detail = await fetch(`${ctx.base}/api/forum/topics/${stored.id}`).then((r) => r.json());
  assert.ok(!detail.title.includes("\u0000"));
  await ctx.close();
});

test("forum: sanitizeSingleLine collapses whitespace and strips control chars", () => {
  const out = sanitizeSingleLine("a\u0000  b\n\tc   d", 100);
  assert.equal(out, "a b c d");
});

test("forum: sanitizeBody collapses spaces but keeps newlines", () => {
  const out = sanitizeBody("a    b\n\n\n\nc", 1000);
  assert.equal(out, "a b\n\n\nc");
});

/* ============================================================
   D. Report flow
   ============================================================ */

test("forum: report topic and post creates report (201)", async () => {
  const ctx = await makeServer();
  const guest = await createGuest(ctx, "Reporter");
  const created = await createTopic(ctx, guest.anonToken, { title: "T", body: "B" });
  const topicId = created.body.id;

  // report topic (logged-in reporter)
  const r1 = await fetch(`${ctx.base}/api/forum/reports`, {
    method: "POST",
    headers: h(ctx, { "x-forum-token": guest.anonToken }),
    body: JSON.stringify({ targetType: "topic", targetId: topicId, reason: "สแปม" }),
  });
  assert.equal(r1.status, 201);
  assert.equal((await r1.json()).ok, true);

  // report non-existent → 404
  const r2 = await fetch(`${ctx.base}/api/forum/reports`, {
    method: "POST",
    headers: h(ctx, { "x-forum-token": guest.anonToken }),
    body: JSON.stringify({ targetType: "topic", targetId: "ft-deadbeefdeadbeef", reason: "x" }),
  });
  assert.equal(r2.status, 404);
  assert.equal((await r2.json()).error, "target_not_found");

  // report with empty reason → 400
  const r3 = await fetch(`${ctx.base}/api/forum/reports`, {
    method: "POST",
    headers: h(ctx, { "x-forum-token": guest.anonToken }),
    body: JSON.stringify({ targetType: "topic", targetId: topicId, reason: "   " }),
  });
  assert.equal(r3.status, 400);
  assert.equal((await r3.json()).error, "reason_required");

  const unauth = await fetch(`${ctx.base}/api/forum/reports`, {
    method: "POST",
    headers: h(ctx),
    body: JSON.stringify({ targetType: "topic", targetId: topicId, reason: "spam" }),
  });
  assert.equal(unauth.status, 401);
  assert.equal((await unauth.json()).error, "auth_required");

  await ctx.close();
});

/* ============================================================
   E. Rate limit
   ============================================================ */

test("forum: rate limit returns 429 with retry-after when burst exhausted", async () => {
  const { createRateLimiter } = await import("../src/forum/rateLimiter.js");
  let nowMs = Date.parse("2026-07-16T05:00:00Z");
  const rl = createRateLimiter({ windowSeconds: 60, burst: 2, now: () => nowMs });
  const ctx = await makeServer({ rateLimiter: rl });

  const guest = await createGuest(ctx, "Spammer");
  const t1 = await createTopic(ctx, guest.anonToken, { title: "T1", body: "B" });
  const t2 = await createTopic(ctx, guest.anonToken, { title: "T2", body: "B" });
  assert.equal(t1.status, 201);
  assert.equal(t2.status, 201);
  // ครั้งที่ 3 → 429 + retry-after header
  const t3 = await fetch(`${ctx.base}/api/forum/topics`, {
    method: "POST",
    headers: h(ctx, { "x-forum-token": guest.anonToken }),
    body: JSON.stringify({ categorySlug: "general", title: "T3", body: "B" }),
  });
  assert.equal(t3.status, 429);
  assert.equal((await t3.json()).error, "rate_limited");
  assert.ok(t3.headers.get("retry-after"), "retry-after header must be set");

  // หลังเลื่อนเวลาพ้น window → ผ่านอีกครั้ง
  nowMs += 61_000;
  const t4 = await createTopic(ctx, guest.anonToken, { title: "T4", body: "B" });
  assert.equal(t4.status, 201);

  await ctx.close();
});

/* ============================================================
   F. Upload validation (sanitize layer)
   ============================================================ */

test("forum: validateUpload rejects executable extension", () => {
  const r = validateUpload({ originalName: "evil.exe", mimeType: "application/x-msdownload", byteSize: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "extension_not_allowed");
});

test("forum: validateUpload rejects extension/mime mismatch", () => {
  const r = validateUpload({ originalName: "img.png", mimeType: "application/pdf", byteSize: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "mime_extension_mismatch");
});

test("forum: validateUpload rejects mismatched magic bytes", () => {
  const pdfMagic = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
  const r = validateUpload({
    originalName: "img.png",
    mimeType: "image/png",
    byteSize: 100,
    buffer: pdfMagic,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "magic_extension_mismatch");
});

test("forum: validateUpload accepts valid PNG (magic + mime + ext match)", () => {
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const r = validateUpload({
    originalName: "ok.png",
    mimeType: "image/png",
    byteSize: 100,
    buffer: pngMagic,
  });
  assert.equal(r.ok, true);
  assert.equal(r.ext, ".png");
  assert.equal(r.mime, "image/png");
});

test("forum: validateUpload accepts webp with WEBP tag at offset 8", () => {
  const buf = Buffer.alloc(12);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(0, 4);
  buf.write("WEBP", 8, "latin1");
  const r = validateUpload({
    originalName: "ok.webp",
    mimeType: "image/webp",
    byteSize: 100,
    buffer: buf,
  });
  assert.equal(r.ok, true);
});

test("forum: validateUpload rejects RIFF-without-WEBP (disguised wav)", () => {
  const buf = Buffer.alloc(12);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(0, 4);
  buf.write("WAVE", 8, "latin1"); // ไม่ใช่ WEBP
  const r = validateUpload({
    originalName: "fake.webp",
    mimeType: "image/webp",
    byteSize: 100,
    buffer: buf,
  });
  assert.equal(r.ok, false);
});

test("forum: sanitizeFileName blocks path traversal", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFileName("..\\..\\evil.dll"), null); // .dll ติด dangerous pattern
  assert.equal(sanitizeFileName("ok.png"), "ok.png");
});

test("forum: owner uploads and downloads a validated attachment", async () => {
  const ctx = await makeServer();
  try {
    const guest = await createGuest(ctx, "Uploader");
    const created = await createTopic(ctx, guest.anonToken, {
      title: "Attachment topic",
      body: "Files",
    });
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const form = new FormData();
    form.append("ownerType", "topic");
    form.append("ownerId", created.body.id);
    form.append("file", new Blob([png], { type: "image/png" }), "proof.png");
    const uploaded = await fetch(`${ctx.base}/api/forum/attachments`, {
      method: "POST",
      headers: {
        origin: ctx.selfOrigin,
        "x-forum-token": guest.anonToken,
      },
      body: form,
    });
    assert.equal(uploaded.status, 201);
    const attachment = await uploaded.json();
    assert.equal(attachment.originalName, "proof.png");
    assert.equal(attachment.mimeType, "image/png");
    assert.match(attachment.url, /^\/api\/forum\/attachments\//);

    const downloaded = await fetch(ctx.base + attachment.url);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
  } finally {
    await ctx.close();
  }
});

test("forum: attachment upload rejects non-owner and bad magic bytes", async () => {
  const ctx = await makeServer();
  try {
    const owner = await createGuest(ctx, "Owner");
    const other = await createGuest(ctx, "Other");
    const created = await createTopic(ctx, owner.anonToken, {
      title: "Protected",
      body: "Files",
    });

    async function upload(token, bytes) {
      const form = new FormData();
      form.append("ownerType", "topic");
      form.append("ownerId", created.body.id);
      form.append("file", new Blob([bytes], { type: "image/png" }), "proof.png");
      return fetch(`${ctx.base}/api/forum/attachments`, {
        method: "POST",
        headers: { origin: ctx.selfOrigin, "x-forum-token": token },
        body: form,
      });
    }

    const badMagic = await upload(owner.anonToken, Buffer.from("not a png"));
    assert.equal(badMagic.status, 400);
    assert.equal((await badMagic.json()).error, "magic_unknown");

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const forbidden = await upload(other.anonToken, png);
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error, "not_owner");
  } finally {
    await ctx.close();
  }
});

/* ============================================================
   G. Path traversal (attachments endpoint)
   ============================================================ */

test("forum: attachments endpoint rejects path traversal", async () => {
  const ctx = await makeServer();
  const res = await fetch(`${ctx.base}/api/forum/attachments/..%2F..%2Fetc%2Fpasswd`);
  assert.equal(res.status, 404); // resolveSafe คืน null → 404 (ไม่ leak)
  await ctx.close();
});

/* ============================================================
   H. Search + sort + categories
   ============================================================ */

test("forum: search matches title/body substring", async () => {
  const ctx = await makeServer();
  const guest = await createGuest(ctx, "Searcher");
  await createTopic(ctx, guest.anonToken, { title: "Gold strategy", body: "Scalping XAUUSD" });
  await createTopic(ctx, guest.anonToken, { title: "Random", body: "Nothing here" });
  const r = await fetch(`${ctx.base}/api/forum/topics?search=Gold`).then((r) => r.json());
  assert.equal(r.total, 1);
  assert.equal(r.items[0].title, "Gold strategy");
  await ctx.close();
});

test("forum: category filter limits results", async () => {
  const ctx = await makeServer();
  const guest = await createGuest(ctx, "Cat");
  await createTopic(ctx, guest.anonToken, { categorySlug: "general", title: "G", body: "B" });
  await createTopic(ctx, guest.anonToken, { categorySlug: "tricks", title: "T", body: "B" });
  const general = await fetch(`${ctx.base}/api/forum/topics?category=general`).then((r) => r.json());
  assert.equal(general.total, 1);
  assert.equal(general.items[0].categorySlug, "general");
  await ctx.close();
});

test("forum: categories listing returns all 5 seeded categories", async () => {
  const ctx = await makeServer();
  const cats = await fetch(`${ctx.base}/api/forum/categories`).then((r) => r.json());
  assert.equal(cats.items.length, 5);
  const slugs = cats.items.map((c) => c.slug);
  assert.ok(slugs.includes("ea-indicator"));
  assert.ok(slugs.includes("marketplace"));
  assert.ok(slugs.includes("general"));
  const mp = cats.items.find((c) => c.slug === "marketplace");
  assert.equal(mp.isMarketplace, true);
  await ctx.close();
});

test("forum: invalid category returns 404 detail", async () => {
  const ctx = await makeServer();
  const res = await fetch(`${ctx.base}/api/forum/categories/does-not-exist`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "category_not_found");
  await ctx.close();
});

test("forum: topic detail increments view count", async () => {
  const ctx = await makeServer();
  const guest = await createGuest(ctx, "Viewer");
  const created = await createTopic(ctx, guest.anonToken, { title: "T", body: "B" });
  await fetch(`${ctx.base}/api/forum/topics/${created.body.id}`).then((r) => r.json());
  await fetch(`${ctx.base}/api/forum/topics/${created.body.id}`).then((r) => r.json());
  const detail = await fetch(`${ctx.base}/api/forum/topics/${created.body.id}`).then((r) => r.json());
  assert.equal(detail.viewCount, 3);
  await ctx.close();
});

/* ============================================================
   I. Guest identity (anon token not leaked in other responses)
   ============================================================ */

test("forum: anon token is not leaked in topic/post/category responses", async () => {
  const ctx = await makeServer();
  const guest = await createGuest(ctx, "Leak");
  const anonToken = guest.anonToken;
  const created = await createTopic(ctx, guest.anonToken, { title: "T", body: "B" });

  // topic detail ไม่ควรมี anonToken
  const detail = await fetch(`${ctx.base}/api/forum/topics/${created.body.id}`).then((r) => r.json());
  assert.equal(JSON.stringify(detail).includes(anonToken), false, "anonToken must not leak");
  assert.equal(detail.author.displayName, "Leak");
  assert.equal(detail.author.kind, "guest");
  assert.equal(detail.author.anonToken, undefined);

  // categories response ไม่มี anonToken
  const cats = await fetch(`${ctx.base}/api/forum/categories`).then((r) => r.json());
  assert.equal(JSON.stringify(cats).includes(anonToken), false);
  await ctx.close();
});

test("forum: invalid anon token resolves to null author (no error)", async () => {
  const ctx = await makeServer();
  const res = await fetch(`${ctx.base}/api/forum/topics`, {
    method: "POST",
    headers: h(ctx, { "x-forum-token": "deadbeef".repeat(8) }),
    body: JSON.stringify({ categorySlug: "general", title: "T", body: "B" }),
  });
  assert.equal(res.status, 401);
  await ctx.close();
});

/* ============================================================
   J. Stats endpoint
   ============================================================ */

test("forum: stats endpoint returns counts", async () => {
  const ctx = await makeServer();
  const guest = await createGuest(ctx, "Stat");
  await createTopic(ctx, guest.anonToken, { title: "T", body: "B" });
  const stats = await fetch(`${ctx.base}/api/forum/stats`).then((r) => r.json());
  assert.equal(stats.topics, 1);
  assert.equal(stats.posts, 0);
  assert.equal(stats.categories, 5);
  assert.equal(stats.openReports, 0);
  await ctx.close();
});
