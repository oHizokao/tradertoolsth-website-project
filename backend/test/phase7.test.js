/* ============================================================
   Phase 7 — News listing contract tests
   ------------------------------------------------------------
   ครอบคลุม:
   - sorting ใหม่ → เก่า (COALESCE published_at, original_published_at, created_at)
   - public API คืนเฉพาะ published + validated (ไม่มี draft/ready/rejected/failed/processing)
   - pagination: limit / offset / total / hasMore (รวม category filter)
   - limit/offset validation (bad/missing/oversize/clamped)
   - edge cases: 0, 1, 3, 4, 9, >9 ข่าว
   - detail id/slug correctness
   - envelope ตาม default; ?format=array สำหรับ client เก่า

   ใช้ in-memory test DB (createTestDb) → ไม่แตะ production news.db
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createHttpServer, listen } from "../src/api/server.js";
import { resolve } from "node:path";

/* สร้าง news object เบื้องต้นที่พร้อม publish */
function makeNews(id, overrides = {}) {
  const created = overrides.originalPublishedAt || overrides.publishedAt || "2026-01-01T00:00:00.000Z";
  return {
    id,
    source: "Kitco News",
    sourceUrl: `https://www.kitco.com/news/${id}`,
    originalTitle: `Gold news ${id}`,
    originalAuthor: "Kitco",
    originalPublishedAt: created,
    // Phase 8: sourcePublishedAt เป็นตัวเรียงหลัก ต้องไม่ null จึงจะปรากฏใน listing
    // default เท่ากับ created เพื่อ backward-compat กับ assertion สมัยใช้ publishedAt เรียง
    sourcePublishedAt: created,
    category: "Market News",
    originalContent: "Gold prices moved. ".repeat(6),
    thaiTitle: `ทองคำข่าว ${id}`,
    thaiSummary: `สรุปข่าว ${id}`,
    thaiContent: [`เนื้อหาข่าว ${id} วรรคหนึ่ง`, `เนื้อหาข่าว ${id} วรรคสอง`],
    marketFactors: "ดอกเบี้ยและดอลลาร์",
    keyFacts: [],
    mentionedNumbers: [],
    credit: "เรียบเรียงจาก Kitco News",
    imageUrl: `https://images.pexels.com/photos/${id}.jpeg`,
    imageSource: "Pexels",
    imageAuthor: "Tester",
    imageAuthorUrl: "https://www.pexels.com/@t",
    imageLicense: "Pexels License",
    imageSourceUrl: `https://www.pexels.com/photo/${id}/`,
    imageSearchKeywords: ["gold"],
    imageStatus: "selected",
    imageReviewRequired: false,
    validationStatus: "validated",
    publishStatus: "published",
    aiConfidence: 95,
    aiValidation: { isValid: true },
    duplicateHash: `hash-${id}`,
    sourcePolicy: "trusted",
    sourcePolicyReason: "kitco",
    topics: ["gold"],
    section: "Latest Metals News",
    teaser: "Gold",
    isExternal: false,
    pipelineNote: "validated",
    createdAt: created,
    updatedAt: created,
    validatedAt: created,
    publishedAt: created,
    ...overrides,
  };
}

/** สร้าง server บน test DB + publish ข่าวใน ids */
async function makeServer(repo, projectRoot) {
  const server = createHttpServer({
    repo,
    projectRoot,
    siteVersion: "2",
    adminToken: "",
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  return { server, base: `http://127.0.0.1:${address.port}` };
}

const projectRoot = resolve(process.cwd(), "..");

/* ---------- 1) Sorting ใหม่ → เก่า ---------- */
test("news sorted newest → oldest by publishedAt", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const n1 = makeNews("n-1", { publishedAt: "2026-07-10T00:00:00.000Z" });
  const n2 = makeNews("n-2", { publishedAt: "2026-07-15T00:00:00.000Z" });
  const n3 = makeNews("n-3", { publishedAt: "2026-07-12T00:00:00.000Z" });
  [n1, n2, n3].forEach((n) => repo.insertNews(n));

  const { server, base } = await makeServer(repo, projectRoot);
  const res = await fetch(`${base}/api/news`).then((r) => r.json());
  assert.deepEqual(res.items.map((i) => i.id), ["n-2", "n-3", "n-1"]);
  await new Promise((r) => server.close(r));
  db.close();
});

test("news sorted by original_published_at when publishedAt missing", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const a = makeNews("a", { publishedAt: null, originalPublishedAt: "2026-07-05T00:00:00.000Z", createdAt: "2026-07-01T00:00:00.000Z" });
  const b = makeNews("b", { publishedAt: null, originalPublishedAt: "2026-07-09T00:00:00.000Z", createdAt: "2026-07-01T00:00:00.000Z" });
  [a, b].forEach((n) => repo.insertNews(n));

  const { server, base } = await makeServer(repo, projectRoot);
  const res = await fetch(`${base}/api/news`).then((r) => r.json());
  assert.deepEqual(res.items.map((i) => i.id), ["b", "a"]);
  await new Promise((r) => server.close(r));
  db.close();
});

test("news missing sourcePublishedAt are excluded from public listing (no fallback)", async () => {
  // Phase 8: ห้าม fallback ไป createdAt/publishedAt
  // ข่าวที่ไม่มี sourcePublishedAt ต้องไม่ปรากฏใน public API
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const x = makeNews("x", { sourcePublishedAt: null, publishedAt: "2026-07-08T00:00:00.000Z", originalPublishedAt: "2026-07-08T00:00:00.000Z", createdAt: "2026-07-03T00:00:00.000Z" });
  const y = makeNews("y", { sourcePublishedAt: null, publishedAt: "2026-07-09T00:00:00.000Z", originalPublishedAt: "2026-07-09T00:00:00.000Z", createdAt: "2026-07-08T00:00:00.000Z" });
  [x, y].forEach((n) => repo.insertNews(n));

  const { server, base } = await makeServer(repo, projectRoot);
  const res = await fetch(`${base}/api/news`).then((r) => r.json());
  assert.equal(res.items.length, 0, "ข่าวที่ไม่มี sourcePublishedAt ต้องไม่ปรากฏ");
  assert.equal(res.total, 0);
  await new Promise((r) => server.close(r));
  db.close();
});

/* ---------- 2) Public API คืนเฉพาะ published + validated ---------- */
test("public API excludes draft/ready/rejected/processing/failed", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const pub = makeNews("pub-ok");
  const draft = makeNews("pub-draft", { publishStatus: "draft" });
  const ready = makeNews("pub-ready", { publishStatus: "ready" });
  const rejected = makeNews("pub-rejected", { publishStatus: "rejected", validationStatus: "rejected" });
  const processing = makeNews("pub-processing", { publishStatus: "processing" });
  const failed = makeNews("pub-failed", { publishStatus: "failed" });
  const notValidated = makeNews("pub-notvalidated", { publishStatus: "published", validationStatus: "needs_review" });
  [pub, draft, ready, rejected, processing, failed, notValidated].forEach((n) => repo.insertNews(n));

  const { server, base } = await makeServer(repo, projectRoot);
  const res = await fetch(`${base}/api/news`).then((r) => r.json());
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].id, "pub-ok");
  assert.equal(res.total, 1);
  await new Promise((r) => server.close(r));
  db.close();
});

/* ---------- 3) Pagination ---------- */
test("pagination returns correct items/total/hasMore", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  // สร้างข่าว 9 ตัว เวลาต่างกัน (เรียงใหม่→เก่า)
  for (let i = 1; i <= 9; i++) {
    const dt = new Date(Date.UTC(2026, 6, i)).toISOString();
    repo.insertNews(makeNews(`p-${String(i).padStart(2, "0")}`, { publishedAt: dt, originalPublishedAt: dt, createdAt: dt }));
  }

  const { server, base } = await makeServer(repo, projectRoot);

  // page 1: limit 3, offset 0
  const p1 = await fetch(`${base}/api/news?limit=3&offset=0`).then((r) => r.json());
  assert.equal(p1.items.length, 3);
  assert.equal(p1.items[0].id, "p-09"); // ใหม่สุด
  assert.equal(p1.total, 9);
  assert.equal(p1.hasMore, true);
  assert.equal(p1.limit, 3);
  assert.equal(p1.offset, 0);

  // page 2: limit 3, offset 3
  const p2 = await fetch(`${base}/api/news?limit=3&offset=3`).then((r) => r.json());
  assert.equal(p2.items.length, 3);
  assert.equal(p2.items[0].id, "p-06");
  assert.equal(p2.hasMore, true);

  // page 3: limit 3, offset 6
  const p3 = await fetch(`${base}/api/news?limit=3&offset=6`).then((r) => r.json());
  assert.equal(p3.items.length, 3);
  assert.equal(p3.items[0].id, "p-03");
  assert.equal(p3.hasMore, false);

  // offset เกิน total → empty + hasMore false
  const p4 = await fetch(`${base}/api/news?limit=3&offset=20`).then((r) => r.json());
  assert.equal(p4.items.length, 0);
  assert.equal(p4.hasMore, false);

  // ทุกหน้ารวมกันต้องครบ 9 และไม่ซ้ำ
  const all = [...p1.items, ...p2.items, ...p3.items];
  assert.equal(all.length, 9);
  assert.equal(new Set(all.map((i) => i.id)).size, 9);

  await new Promise((r) => server.close(r));
  db.close();
});

test("pagination respects category filter in totals", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  // 4 gold (topic gold) + 2 forex (no gold keyword)
  for (let i = 1; i <= 4; i++) {
    const dt = new Date(Date.UTC(2026, 6, i)).toISOString();
    repo.insertNews(makeNews(`g-${i}`, { publishedAt: dt, originalPublishedAt: dt, createdAt: dt, topics: ["gold"] }));
  }
  for (let i = 1; i <= 2; i++) {
    const dt = new Date(Date.UTC(2026, 6, 10 + i)).toISOString();
    repo.insertNews(makeNews(`f-${i}`, {
      publishedAt: dt, originalPublishedAt: dt, createdAt: dt,
      topics: ["forex"], originalTitle: `Euro dollar news ${i}`, thaiTitle: `ยูโร ${i}`,
    }));
  }

  const { server, base } = await makeServer(repo, projectRoot);
  const gold = await fetch(`${base}/api/news?category=gold&limit=2&offset=0`).then((r) => r.json());
  assert.equal(gold.total, 4);
  assert.equal(gold.items.length, 2);
  assert.equal(gold.hasMore, true);
  assert.equal(gold.items.every((i) => i.category === "gold"), true);

  const forex = await fetch(`${base}/api/news?category=forex&limit=2&offset=0`).then((r) => r.json());
  assert.equal(forex.total, 2);
  assert.equal(forex.items.length, 2);
  assert.equal(forex.hasMore, false);

  const all = await fetch(`${base}/api/news?category=all&limit=10`).then((r) => r.json());
  assert.equal(all.total, 6);

  await new Promise((r) => server.close(r));
  db.close();
});

/* ---------- 4) limit/offset validation ---------- */
test("limit/offset bad values fall back to safe defaults and clamp", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  for (let i = 1; i <= 3; i++) {
    const dt = new Date(Date.UTC(2026, 6, i)).toISOString();
    repo.insertNews(makeNews(`v-${i}`, { publishedAt: dt, originalPublishedAt: dt, createdAt: dt }));
  }

  const { server, base } = await makeServer(repo, projectRoot);

  // ค่าผิด → default (limit 50, offset 0)
  const bad = await fetch(`${base}/api/news?limit=abc&offset=xyz`).then((r) => r.json());
  assert.equal(bad.limit, 50);
  assert.equal(bad.offset, 0);
  assert.equal(bad.items.length, 3);

  // limit ติดลบ/ศูนย์ → clamp กลับ
  const neg = await fetch(`${base}/api/news?limit=-5`).then((r) => r.json());
  assert.equal(neg.limit, 1); // clamp min 1

  // limit เกิน max → clamp ลง 50
  const over = await fetch(`${base}/api/news?limit=99999`).then((r) => r.json());
  assert.equal(over.limit, 50);

  // offset ติดลบ → clamp กลับ 0
  const noff = await fetch(`${base}/api/news?offset=-10`).then((r) => r.json());
  assert.equal(noff.offset, 0);

  // ไม่ส่งเลย → default
  const none = await fetch(`${base}/api/news`).then((r) => r.json());
  assert.equal(none.limit, 50);
  assert.equal(none.offset, 0);

  await new Promise((r) => server.close(r));
  db.close();
});

/* ---------- 5) Edge cases: 0, 1, 3, 4, 9, >9 ---------- */
test("edge: 0 published news returns empty envelope", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const { server, base } = await makeServer(repo, projectRoot);
  const res = await fetch(`${base}/api/news?limit=3`).then((r) => r.json());
  assert.equal(res.items.length, 0);
  assert.equal(res.total, 0);
  assert.equal(res.hasMore, false);
  await new Promise((r) => server.close(r));
  db.close();
});

test("edge: 1 news — hasMore false", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  repo.insertNews(makeNews("only-1", { publishedAt: "2026-07-01T00:00:00.000Z" }));
  const { server, base } = await makeServer(repo, projectRoot);
  const res = await fetch(`${base}/api/news?limit=3`).then((r) => r.json());
  assert.equal(res.items.length, 1);
  assert.equal(res.hasMore, false);
  await new Promise((r) => server.close(r));
  db.close();
});

test("edge: exactly 3 — hasMore false (no 'more' section needed)", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  for (let i = 1; i <= 3; i++) {
    const dt = new Date(Date.UTC(2026, 6, i)).toISOString();
    repo.insertNews(makeNews(`e3-${i}`, { publishedAt: dt, originalPublishedAt: dt, createdAt: dt }));
  }
  const { server, base } = await makeServer(repo, projectRoot);
  const latest = await fetch(`${base}/api/news?limit=3&offset=0`).then((r) => r.json());
  assert.equal(latest.items.length, 3);
  assert.equal(latest.hasMore, false);
  const more = await fetch(`${base}/api/news?limit=6&offset=3`).then((r) => r.json());
  assert.equal(more.items.length, 0);
  assert.equal(more.hasMore, false);
  await new Promise((r) => server.close(r));
  db.close();
});

test("edge: exactly 4 — 3 latest + 1 more", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  for (let i = 1; i <= 4; i++) {
    const dt = new Date(Date.UTC(2026, 6, i)).toISOString();
    repo.insertNews(makeNews(`e4-${i}`, { publishedAt: dt, originalPublishedAt: dt, createdAt: dt }));
  }
  const { server, base } = await makeServer(repo, projectRoot);
  const latest = await fetch(`${base}/api/news?limit=3&offset=0`).then((r) => r.json());
  assert.equal(latest.items.length, 3);
  assert.equal(latest.total, 4);
  assert.equal(latest.hasMore, true);
  // more offset 3 → เหลือ 1
  const more = await fetch(`${base}/api/news?limit=6&offset=3`).then((r) => r.json());
  assert.equal(more.items.length, 1);
  assert.equal(more.items[0].id, "e4-1");
  assert.equal(more.hasMore, false);
  await new Promise((r) => server.close(r));
  db.close();
});

test("edge: 9 news — 3 latest + 6 more covers all, no dup", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  for (let i = 1; i <= 9; i++) {
    const dt = new Date(Date.UTC(2026, 6, i)).toISOString();
    repo.insertNews(makeNews(`e9-${String(i).padStart(2, "0")}`, { publishedAt: dt, originalPublishedAt: dt, createdAt: dt }));
  }
  const { server, base } = await makeServer(repo, projectRoot);
  const latest = await fetch(`${base}/api/news?limit=3&offset=0`).then((r) => r.json());
  const m1 = await fetch(`${base}/api/news?limit=6&offset=3`).then((r) => r.json());
  assert.equal(latest.items.length, 3);
  assert.equal(m1.items.length, 6);
  assert.equal(m1.hasMore, false);
  const all = [...latest.items, ...m1.items];
  assert.equal(new Set(all.map((i) => i.id)).size, 9);
  await new Promise((r) => server.close(r));
  db.close();
});

test("edge: >9 news — paginated fully, newest first throughout", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  for (let i = 1; i <= 14; i++) {
    const dt = new Date(Date.UTC(2026, 6, i)).toISOString();
    repo.insertNews(makeNews(`e14-${String(i).padStart(2, "0")}`, { publishedAt: dt, originalPublishedAt: dt, createdAt: dt }));
  }
  const { server, base } = await makeServer(repo, projectRoot);

  // เก็บผลลัพธ์ทุกหน้า (limit 6 เหมือน "ข่าวเพิ่มเติม")
  const collected = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const page = await fetch(`${base}/api/news?limit=6&offset=${offset}`).then((r) => r.json());
    collected.push(...page.items);
    offset += page.items.length;
    hasMore = page.hasMore;
    if (page.items.length === 0) break; // safety
  }
  assert.equal(collected.length, 14);
  assert.equal(new Set(collected.map((i) => i.id)).size, 14);
  // ใหม่สุดต้องเป็น e14-14, เก่าสุด e14-01
  assert.equal(collected[0].id, "e14-14");
  assert.equal(collected[13].id, "e14-01");

  await new Promise((r) => server.close(r));
  db.close();
});

/* ---------- 6) Detail id/slug correctness ---------- */
test("detail returns correct news by id; unknown id 404", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  repo.insertNews(makeNews("detail-001", { publishedAt: "2026-07-01T00:00:00.000Z" }));
  const { server, base } = await makeServer(repo, projectRoot);

  const d = await fetch(`${base}/api/news/detail-001`).then((r) => r.json());
  assert.equal(d.id, "detail-001");
  assert.equal(d.slug, "detail-001");
  assert.equal(d.title, "ทองคำข่าว detail-001");
  // ข่าวที่ไม่ publish → 404
  const missing = await fetch(`${base}/api/news/nonexistent`);
  assert.equal(missing.status, 404);

  await new Promise((r) => server.close(r));
  db.close();
});

/* ---------- 7) ?format=array backwards-compat ---------- */
test("?format=array returns plain array (legacy clients)", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  for (let i = 1; i <= 2; i++) {
    const dt = new Date(Date.UTC(2026, 6, i)).toISOString();
    repo.insertNews(makeNews(`arr-${i}`, { publishedAt: dt, originalPublishedAt: dt, createdAt: dt }));
  }
  const { server, base } = await makeServer(repo, projectRoot);
  const arr = await fetch(`${base}/api/news?format=array`).then((r) => r.json());
  assert.equal(Array.isArray(arr), true);
  assert.equal(arr.length, 2);
  await new Promise((r) => server.close(r));
  db.close();
});

/* ---------- 8) No secrets leaked ---------- */
test("public response does not expose admin/internal fields", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  repo.insertNews(makeNews("secret-001"));
  const { server, base } = await makeServer(repo, projectRoot);
  const res = await fetch(`${base}/api/news`).then((r) => r.json());
  const item = res.items[0];
  // ฟิลด์ลับ/ภายในต้องไม่อยู่ใน public news
  for (const key of ["validationStatus", "publishStatus", "aiValidation", "duplicateHash", "sourcePolicy", "pipelineNote", "imageReviewRequired", "adminToken"]) {
    assert.equal(item[key], undefined, `field ${key} must not leak`);
  }
  // admin endpoint disabled when no token
  const admin = await fetch(`${base}/api/admin/news`);
  assert.equal(admin.status, 503);
  await new Promise((r) => server.close(r));
  db.close();
});
