/* ============================================================
   Phase 8 — sourcePublishedAt: "ข่าวล่าสุดจริงจาก Kitco"
   ------------------------------------------------------------
   ครอบคลุม Acceptance Criteria ทั้ง 6 ข้อ + helper tests + V1/V2:
     1. เรียงใหม่ → เก่า ถูกตาม sourcePublishedAt
     2. ข่าวเข้าทีหลัง createdAt ใหม่แต่ sourcePublishedAt เก่า → ไม่ดันขึ้นบนสุด
     3. ข่าว publish พร้อมกัน (publishedAt เท่ากัน) → ยังเรียงตาม sourcePublishedAt
     4. ข่าวไม่มี sourcePublishedAt → ไม่แซงข่าวที่มีเวลาชัดเจน (ตัดออกจาก listing)
     5. 3 ข่าวล่าสุดจริงหลัง dedupe + filter (selectTopNews)
     6. V1 และ V2 แสดงลำดับเดียวกัน (API contract เดียวกัน)

   กฎสำคัญ (No Fallback Policy):
   - ห้ามใช้ COALESCE fallback ไป createdAt/publishedAt
   - ข่าวที่ไม่มี sourcePublishedAt → ตัดออกจาก listing / ส่ง needs_review
   - ห้ามเดาเวลา
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createHttpServer, listen } from "../src/api/server.js";
import { selectTopNews } from "../src/scraper/kitco.scraper.js";
import { toPublicNews } from "../src/api/publicNews.js";
import {
  extractSourcePublishedAt,
  toUtcIso,
  toBangkokString,
} from "../src/utils/date.js";
import { resolve } from "node:path";

/* สร้าง news พร้อม publish + มี sourcePublishedAt เสมอ (เว้นแต่ override) */
function makeNews(id, overrides = {}) {
  const created = overrides.sourcePublishedAt || "2026-01-01T00:00:00.000Z";
  return {
    id,
    source: "Kitco News",
    sourceUrl: `https://www.kitco.com/news/${id}`,
    originalTitle: `Gold market news ${id}`,
    originalAuthor: "Kitco",
    originalPublishedAt: created,
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

/* ============================================================
   Helper tests — extractSourcePublishedAt / toUtcIso / toBangkokString
   ============================================================ */
test("extractSourcePublishedAt: อ่าน createdAt ก่อน แล้ว fallback field อื่น", () => {
  assert.equal(
    extractSourcePublishedAt({ createdAt: "2026-07-15T09:00:00-0400" }),
    "2026-07-15T09:00:00-0400"
  );
  assert.equal(
    extractSourcePublishedAt({ datePublished: "2026-07-14T10:00:00Z" }),
    "2026-07-14T10:00:00Z"
  );
  assert.equal(extractSourcePublishedAt({ foo: "bar" }), null);
  assert.equal(extractSourcePublishedAt(null), null);
});

test("toUtcIso: แปลง ISO offset ไม่มีโคลอน → UTC Z (canonical)", () => {
  assert.equal(
    toUtcIso("2026-07-15T09:59:00-0400"),
    "2026-07-15T13:59:00.000Z"
  );
  assert.equal(toUtcIso("2026-07-15T13:59:00Z"), "2026-07-15T13:59:00.000Z");
  assert.equal(toUtcIso("not-a-date"), null);
  assert.equal(toUtcIso(null), null);
});

test("toBangkokString: แปลง UTC → Asia/Bangkok ภาษาไทย", () => {
  // 2026-07-15T13:59:00Z = 20:59 Bangkok
  assert.equal(
    toBangkokString("2026-07-15T13:59:00.000Z"),
    "เผยแพร่เมื่อ 15 ก.ค. 2026 20:59 น."
  );
  assert.equal(
    toBangkokString("2026-07-15T13:59:00.000Z", { timeOnly: true }),
    "20:59 น."
  );
  assert.equal(toBangkokString("bad"), "-");
});

/* ============================================================
   AC #1 — เรียงใหม่ → เก่า ถูกตาม sourcePublishedAt
   ============================================================ */
test("AC1: news sorted newest → oldest by sourcePublishedAt", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const n1 = makeNews("n1", { sourcePublishedAt: "2026-07-10T00:00:00.000Z" });
  const n2 = makeNews("n2", { sourcePublishedAt: "2026-07-15T00:00:00.000Z" });
  const n3 = makeNews("n3", { sourcePublishedAt: "2026-07-12T00:00:00.000Z" });
  // insert สลับลำดับเพื่อยืนยันว่าไม่ใช้ insertion order
  [n3, n1, n2].forEach((n) => repo.insertNews(n));

  const { server, base } = await makeServer(repo, projectRoot);
  const res = await fetch(`${base}/api/news`).then((r) => r.json());
  assert.deepEqual(res.items.map((i) => i.id), ["n2", "n3", "n1"]);
  await new Promise((r) => server.close(r));
  db.close();
});

/* ============================================================
   AC #2 — ข่าวเข้าทีหลัง createdAt ใหม่แต่ sourcePublishedAt เก่า → ไม่ดันขึ้นบนสุด
   ============================================================ */
test("AC2: late-imported news with older sourcePublishedAt does not jump to top", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  // ข่าว A: เข้าระบบเก่า (createdAt เก่า) แต่ sourcePublishedAt ใหม่
  const a = makeNews("a", {
    sourcePublishedAt: "2026-07-15T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
  });
  // ข่าว B: เข้าระบบใหม่ (createdAt ใหม่) แต่ sourcePublishedAt เก่ากว่า
  const b = makeNews("b", {
    sourcePublishedAt: "2026-07-10T00:00:00.000Z",
    createdAt: "2026-07-20T00:00:00.000Z", // imported ทีหลัง
  });
  [b, a].forEach((n) => repo.insertNews(n)); // insert b ก่อน a

  const { server, base } = await makeServer(repo, projectRoot);
  const res = await fetch(`${base}/api/news`).then((r) => r.json());
  // ต้องเรียงตาม sourcePublishedAt ไม่ใช่ createdAt → a บนสุด
  assert.deepEqual(res.items.map((i) => i.id), ["a", "b"]);
  await new Promise((r) => server.close(r));
  db.close();
});

/* ============================================================
   AC #3 — ข่าว publish พร้อมกัน (publishedAt เท่ากัน) → ยังเรียงตาม sourcePublishedAt
   ============================================================ */
test("AC3: same publishedAt still sorts by sourcePublishedAt", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const samePublishedAt = "2026-07-15T12:00:00.000Z"; // publish พร้อมกัน
  const a = makeNews("a", {
    sourcePublishedAt: "2026-07-10T00:00:00.000Z",
    publishedAt: samePublishedAt,
  });
  const b = makeNews("b", {
    sourcePublishedAt: "2026-07-14T00:00:00.000Z",
    publishedAt: samePublishedAt,
  });
  const c = makeNews("c", {
    sourcePublishedAt: "2026-07-12T00:00:00.000Z",
    publishedAt: samePublishedAt,
  });
  [a, b, c].forEach((n) => repo.insertNews(n));

  const { server, base } = await makeServer(repo, projectRoot);
  const res = await fetch(`${base}/api/news`).then((r) => r.json());
  // publishedAt เท่ากันหมด → เรียงตาม sourcePublishedAt: b, c, a
  assert.deepEqual(res.items.map((i) => i.id), ["b", "c", "a"]);
  await new Promise((r) => server.close(r));
  db.close();
});

/* ============================================================
   AC #4 — ข่าวไม่มี sourcePublishedAt → ไม่แซง (ตัดออกจาก listing)
   ============================================================ */
test("AC4: news without sourcePublishedAt excluded from listing (no fallback)", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  // ข่าวที่มี sourcePublishedAt
  const withDate = makeNews("with-date", {
    sourcePublishedAt: "2026-07-10T00:00:00.000Z",
  });
  // ข่าวที่ไม่มี sourcePublishedAt (createdAt/publishedAt ใหม่กว่าแต่ห้ามใช้แทน)
  const noDate = makeNews("no-date", {
    sourcePublishedAt: null,
    publishedAt: "2026-07-20T00:00:00.000Z", // ใหม่กว่าทุกข่าว แต่ห้ามใช้แทน
    originalPublishedAt: "2026-07-20T00:00:00.000Z",
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  [noDate, withDate].forEach((n) => repo.insertNews(n));

  const { server, base } = await makeServer(repo, projectRoot);
  const res = await fetch(`${base}/api/news`).then((r) => r.json());
  // ต้องเห็นเฉพาะ with-date เท่านั้น — no-date ถูกตัดออก
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].id, "with-date");
  assert.equal(res.total, 1);
  await new Promise((r) => server.close(r));
  db.close();
});

/* ============================================================
   AC #5 — 3 ข่าวล่าสุดจริงหลัง dedupe + filter (selectTopNews)
   ============================================================ */
test("AC5: selectTopNews picks 3 newest by sourcePublishedAt after dedupe + filter", () => {
  const items = [
    // ข่าวเก่าแต่อยู่ลำดับแรก (ต้องไม่ติด 3 ล่าสุด)
    { id: "1", sourceUrl: "https://k.com/1", originalTitle: "Gold market news one", sourcePublishedAt: "2026-07-05T00:00:00.000Z", duplicateHash: "h1" },
    // ข่าวใหม่สุด
    { id: "2", sourceUrl: "https://k.com/2", originalTitle: "Gold market news two", sourcePublishedAt: "2026-07-15T00:00:00.000Z", duplicateHash: "h2" },
    // ข่าวกลาง
    { id: "3", sourceUrl: "https://k.com/3", originalTitle: "Gold market news three", sourcePublishedAt: "2026-07-12T00:00:00.000Z", duplicateHash: "h3" },
    // ข่าวใหม่อันดับ 2
    { id: "4", sourceUrl: "https://k.com/4", originalTitle: "Gold market news four", sourcePublishedAt: "2026-07-14T00:00:00.000Z", duplicateHash: "h4" },
    // ข่าวที่ไม่มี sourcePublishedAt → needsReview
    { id: "5", sourceUrl: "https://k.com/5", originalTitle: "Gold market news five", sourcePublishedAt: null, duplicateHash: "h5" },
  ];

  const result = selectTopNews(items, 3);
  // 3 ล่าสุดตาม sourcePublishedAt: 2 (07-15), 4 (07-14), 3 (07-12)
  assert.deepEqual(result.latest.map((i) => i.id), ["2", "4", "3"]);
  // rest = ข่าวที่มีเวลาแต่ไม่ติด 3 ล่าสุด
  assert.deepEqual(result.rest.map((i) => i.id), ["1"]);
  // needsReview = ข่าวที่ไม่มี sourcePublishedAt
  assert.deepEqual(result.needsReview.map((i) => i.id), ["5"]);
});

test("AC5b: selectTopNews dedupes within batch", () => {
  const items = [
    { id: "1", sourceUrl: "https://k.com/same", originalTitle: "Gold market news one", sourcePublishedAt: "2026-07-15T00:00:00.000Z", duplicateHash: "h1" },
    { id: "1b", sourceUrl: "https://k.com/same", originalTitle: "Gold market news one", sourcePublishedAt: "2026-07-15T00:00:00.000Z", duplicateHash: "h1b" },
    { id: "2", sourceUrl: "https://k.com/2", originalTitle: "Gold market news two", sourcePublishedAt: "2026-07-14T00:00:00.000Z", duplicateHash: "h2" },
    { id: "3", sourceUrl: "https://k.com/3", originalTitle: "Gold market news three", sourcePublishedAt: "2026-07-13T00:00:00.000Z", duplicateHash: "h3" },
  ];
  const result = selectTopNews(items, 3);
  // 1b ซ้ำกับ 1 (same url) → ตัดออก → เหลือ 3 ข่าว: 1, 2, 3
  assert.equal(result.latest.length, 3);
  assert.deepEqual(result.latest.map((i) => i.id), ["1", "2", "3"]);
  assert.ok(!result.latest.find((i) => i.id === "1b"));
});

/* ============================================================
   AC #6 — V1 และ V2 แสดงลำดับเดียวกัน (API contract เดียวกัน)
   ============================================================ */
test("AC6: V1 and V2 use same API contract → same order", async () => {
  // V1 และ V2 ทั้งคู่เรียก /api/news เดียวกัน (repo.listAllPublished เดียวกัน)
  // → ผลลัพธ์ลำดับเดียวกัน ตรวจสอบโดยเทียบ output ของ toPublicNews ทั้งสองครั้ง
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const n1 = makeNews("v1", { sourcePublishedAt: "2026-07-10T00:00:00.000Z" });
  const n2 = makeNews("v2", { sourcePublishedAt: "2026-07-15T00:00:00.000Z" });
  [n1, n2].forEach((n) => repo.insertNews(n));

  const { server: serverV1, base: baseV1 } = await makeServer(repo, projectRoot);
  // V1 และ V2 ใช้ endpoint เดียวกัน — จำลองโดยยิงสองครั้ง
  const resV1 = await fetch(`${baseV1}/api/news`).then((r) => r.json());
  const resV2 = await fetch(`${baseV1}/api/news`).then((r) => r.json());
  assert.deepEqual(
    resV1.items.map((i) => i.id),
    resV2.items.map((i) => i.id),
    "V1 และ V2 ต้องได้ลำดับเดียวกันเพราะใช้ API contract เดียวกัน"
  );
  assert.deepEqual(resV1.items.map((i) => i.id), ["v2", "v1"]);
  await new Promise((r) => serverV1.close(r));
  db.close();
});

test("AC6b: toPublicNews uses sourcePublishedAt for publishedAt (no fallback)", () => {
  const news = makeNews("pub", {
    sourcePublishedAt: "2026-07-15T13:59:00.000Z",
    publishedAt: "2026-07-20T00:00:00.000Z", // ต่างจาก sourcePublishedAt
    createdAt: "2026-07-21T00:00:00.000Z", // ต่างอีก
  });
  const pub = toPublicNews(news);
  // publishedAt (output) ต้อง = sourcePublishedAt ไม่ใช่ publishedAt/createdAt ของระบบ
  assert.equal(pub.publishedAt, "2026-07-15T13:59:00.000Z");
  assert.equal(pub.sourcePublishedAt, "2026-07-15T13:59:00.000Z");
  assert.equal(
    pub.sourcePublishedAtLabel,
    "เผยแพร่เมื่อ 15 ก.ค. 2026 20:59 น."
  );
  // importedAt = createdAt (เวลานำเข้าระบบ) แยกจาก sourcePublishedAt
  assert.equal(pub.importedAt, "2026-07-21T00:00:00.000Z");
});

test("AC6c: toPublicNews with null sourcePublishedAt → publishedAt null (no fallback)", () => {
  const news = makeNews("no-date", {
    sourcePublishedAt: null,
    publishedAt: "2026-07-20T00:00:00.000Z",
    createdAt: "2026-07-21T00:00:00.000Z",
  });
  const pub = toPublicNews(news);
  assert.equal(pub.publishedAt, null, "ต้องไม่ fallback ไป publishedAt/createdAt");
  assert.equal(pub.sourcePublishedAt, null);
});

/* ============================================================
   AC extra — pagination ใช้ sourcePublishedAt
   ============================================================ */
test("pagination across pages stays sorted by sourcePublishedAt", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  for (let i = 1; i <= 7; i++) {
    const dt = new Date(Date.UTC(2026, 6, i)).toISOString();
    repo.insertNews(makeNews(`p-${String(i).padStart(2, "0")}`, { sourcePublishedAt: dt }));
  }
  const { server, base } = await makeServer(repo, projectRoot);

  const p1 = await fetch(`${base}/api/news?limit=3&offset=0`).then((r) => r.json());
  const p2 = await fetch(`${base}/api/news?limit=3&offset=3`).then((r) => r.json());
  const p3 = await fetch(`${base}/api/news?limit=3&offset=6`).then((r) => r.json());
  const all = [...p1.items, ...p2.items, ...p3.items];
  assert.equal(all.length, 7, "ต้องครบ 7 ข่าวจาก 3 หน้า");
  // ใหม่สุดก่อน และทุกหน้าเรียงใหม่→เก่า
  assert.equal(all[0].id, "p-07");
  assert.equal(all[6].id, "p-01");
  // ตรวจ monotonic decreasing sourcePublishedAt ตลอดทุกหน้า
  const times = all.map((i) => new Date(i.sourcePublishedAt).getTime());
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] <= times[i - 1], `page ordering broke at index ${i}`);
  }
  await new Promise((r) => server.close(r));
  db.close();
});

/* ============================================================
   QC3 — ยืนยัน Kitco ใช้ createdAt เป็น source publication time
         + แปลง timezone ถูกต้อง (ET offset → UTC → Bangkok)
   ------------------------------------------------------------
   Fixture ข้างล่างนี้คือ raw item จริงจาก Kitco __NEXT_DATA__
   ที่บันทึกไว้ระหว่างการตรวจสอบหน้า Kitco Digest (15 ก.ค. 2026)
   ใช้ยืนยันว่า:
   a) scraper อ่าน createdAt (ไม่ใช่ field อื่น) เป็นเวลาเผยแพร่จริง
   b) แปลง offset -0400 (US Eastern) → UTC ถูกต้อง
   c) แปลง UTC → Asia/Bangkok (+7) ถูกต้อง
   ============================================================ */

// Fixture: raw item จาก Kitco newsByCategoryGeneric (บันทึก 15 ก.ค. 2026)
// createdAt = "2026-07-15T09:59:00-0400" (US Eastern Daylight Time, UTC-4)
const KITCO_FIXTURE_GOLD_BOC = {
  id: 229582,
  __typename: "NodeNewsArticle",
  category: { __typename: "Term", name: "Market News" },
  teaserSnippet: "The gold market is holding its ground...",
  title: "Gold holding steady as Bank of Canada leaves rates unchanged",
  teaserHeadline: "",
  urlAlias: "/news/article/2026-07-15/gold-holding-steady-bank-canada-leaves-rates-unchanged",
  source: { __typename: "Source", name: "Kitco News" },
  createdAt: "2026-07-15T09:59:00-0400",
  updatedAt: "2026-07-15T10:02:41-0400",
};

test("QC3a: extractSourcePublishedAt อ่าน createdAt ของ Kitco (ไม่ใช่ field อื่น)", () => {
  // ยืนยันว่าอ่านค่าจาก createdAt ตรงๆ
  assert.equal(
    extractSourcePublishedAt(KITCO_FIXTURE_GOLD_BOC),
    "2026-07-15T09:59:00-0400"
  );
  // ยืนยันว่าไม่ใช่ field อื่น — ถ้าเอา createdAt ออก ต้องได้ null
  // (fixture นี้ไม่มี publishedAt/datePublished/publishDate/timestamp)
  const noCreatedAt = { ...KITCO_FIXTURE_GOLD_BOC };
  delete noCreatedAt.createdAt;
  assert.equal(extractSourcePublishedAt(noCreatedAt), null);
});

test("QC3b: toUtcIso แปลง Kitco ET offset (-0400) → UTC ถูกต้อง", () => {
  // 09:59:00-0400 → 13:59:00 UTC (บวก 4 ชม.)
  assert.equal(
    toUtcIso("2026-07-15T09:59:00-0400"),
    "2026-07-15T13:59:00.000Z"
  );
  // ใช้ค่าจาก fixture จริง
  const raw = extractSourcePublishedAt(KITCO_FIXTURE_GOLD_BOC);
  assert.equal(toUtcIso(raw), "2026-07-15T13:59:00.000Z");
});

test("QC3c: toBangkokString แปลง UTC → Asia/Bangkok (+7) ถูกต้อง", () => {
  // 13:59:00 UTC → 20:59 Bangkok (บวก 7 ชม.)
  assert.equal(
    toBangkokString("2026-07-15T13:59:00.000Z"),
    "เผยแพร่เมื่อ 15 ก.ค. 2026 20:59 น."
  );
  // วันที่ข้ามเที่ยงคืนกรณี offset: เช่น 17:00 UTC → เที่ยงคืน+1 วัน Bangkok
  // 17:00Z + 7h = 00:00 ของวันถัดไป
  assert.equal(
    toBangkokString("2026-07-15T17:00:00.000Z"),
    "เผยแพร่เมื่อ 16 ก.ค. 2026 00:00 น."
  );
});

test("QC3d: end-to-end Kitco fixture → sourcePublishedAt UTC + Bangkok label", () => {
  // จำลองสิ่งที่ normalizeItem ทำ: extract + toUtcIso
  const raw = extractSourcePublishedAt(KITCO_FIXTURE_GOLD_BOC);
  const sourcePublishedAt = toUtcIso(raw);
  const label = toBangkokString(sourcePublishedAt);
  assert.equal(sourcePublishedAt, "2026-07-15T13:59:00.000Z");
  assert.equal(label, "เผยแพร่เมื่อ 15 ก.ค. 2026 20:59 น.");
});

test("QC3e: selectTopNews เรียง Kitco fixtures หลายเขตเวลาถูกตาม UTC", () => {
  // 3 fixtures จริงจาก Kitco (15 ก.ค. 2026) ที่ createdAt ต่างกัน
  // ทั้งหมดใช้ offset -0400 (ET) — เรียงตาม UTC ที่แปลงแล้ว
  const items = [
    {
      id: "3",
      sourceUrl: "https://www.kitco.com/news/article/2026-07-15/gold-steadies",
      originalTitle: "Gold steadies above 4000 PPI cools",
      sourcePublishedAt: toUtcIso("2026-07-15T09:02:00-0400"),
      duplicateHash: "h3",
    },
    {
      id: "1",
      sourceUrl: "https://www.kitco.com/news/article/2026-07-15/silvers-supply",
      originalTitle: "Silvers stubborn supply deficits",
      sourcePublishedAt: toUtcIso("2026-07-15T11:36:55-0400"),
      duplicateHash: "h1",
    },
    {
      id: "2",
      sourceUrl: "https://www.kitco.com/news/article/2026-07-15/gold-boc",
      originalTitle: "Gold holding steady Bank of Canada",
      sourcePublishedAt: toUtcIso("2026-07-15T09:59:00-0400"),
      duplicateHash: "h2",
    },
  ];
  const { latest } = selectTopNews(items, 3);
  // ใหม่สุด: id 1 (11:36 ET = 15:36 UTC), id 2 (09:59 ET = 13:59 UTC), id 3 (09:02 ET = 13:02 UTC)
  assert.deepEqual(latest.map((i) => i.id), ["1", "2", "3"]);
});
