import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createHttpServer, listen } from "../src/api/server.js";
import { toPublicNews } from "../src/api/publicNews.js";
import {
  createNewsUpdater,
  executeNewsUpdate,
  isReadyForAutoPublish,
} from "../src/pipeline/runNewsUpdate.js";
import { createNewsScheduler } from "../src/scheduler/newsScheduler.js";
import { resolve } from "node:path";

function sampleNews(overrides = {}) {
  const now = "2026-07-15T08:00:00.000Z";
  return {
    id: "gold-fed-001",
    source: "Kitco News",
    sourceUrl: "https://www.kitco.com/news/article/gold-fed-001",
    originalTitle: "Gold rises as Fed rate expectations change",
    originalAuthor: "Kitco News",
    originalPublishedAt: now,
    // Phase 8: sourcePublishedAt เป็นตัวเรียงหลัก — ต้องไม่ null จึงจะปรากฏใน listing
    sourcePublishedAt: now,
    category: "Market News",
    originalContent: "Gold prices moved higher after interest-rate expectations changed. ".repeat(5),
    thaiTitle: "ทองคำปรับตัวขึ้น หลังมุมมองดอกเบี้ยเฟดเปลี่ยน",
    thaiSummary: "ราคาทองคำขยับขึ้น ขณะที่ตลาดประเมินแนวโน้มดอกเบี้ยใหม่",
    thaiContent: [
      "ราคาทองคำปรับตัวสูงขึ้น หลังนักลงทุนทบทวนแนวโน้มอัตราดอกเบี้ยของธนาคารกลางสหรัฐ",
      "ข้อมูลดังกล่าวอาจเพิ่มความผันผวนให้ตลาดระยะสั้น โดยยังต้องติดตามตัวเลขเศรษฐกิจถัดไป",
    ],
    marketFactors: "ดอกเบี้ยสหรัฐและค่าเงินดอลลาร์",
    keyFacts: ["ราคาทองคำปรับขึ้น"],
    mentionedNumbers: [],
    credit: "เรียบเรียงจาก Kitco News",
    imageUrl: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg",
    imageSource: "Pexels",
    imageAuthor: "Tester",
    imageAuthorUrl: "https://www.pexels.com/@tester",
    imageLicense: "Pexels License",
    imageSourceUrl: "https://www.pexels.com/photo/1/",
    imageSearchKeywords: ["gold market"],
    imageStatus: "selected",
    imageReviewRequired: false,
    validationStatus: "validated",
    publishStatus: "processing",
    aiConfidence: 94,
    aiValidation: { isValid: true },
    duplicateHash: "hash-gold-fed-001",
    sourcePolicy: "trusted",
    sourcePolicyReason: "kitco",
    topics: ["gold", "fed"],
    section: "Latest Metals News",
    teaser: "Gold rises",
    isExternal: false,
    pipelineNote: "validated",
    createdAt: now,
    updatedAt: now,
    validatedAt: now,
    publishedAt: null,
    ...overrides,
  };
}

test("public mapper returns the exact V1/V2 card/detail schema", () => {
  const item = toPublicNews(sampleNews());
  assert.equal(item.slug, "gold-fed-001");
  assert.equal(item.category, "gold");
  assert.equal(item.impact, "high");
  assert.equal(item.body.length, 2);
  assert.equal(item.body[0].type, "p");
  assert.equal(item.imageCredit.source, "Pexels");
});

test("auto publish gate fails closed", () => {
  assert.equal(isReadyForAutoPublish(sampleNews()), true);
  assert.equal(isReadyForAutoPublish(sampleNews({ validationStatus: "needs_review" })), false);
  assert.equal(isReadyForAutoPublish(sampleNews({ imageReviewRequired: true })), false);
  assert.equal(isReadyForAutoPublish(sampleNews({ sourceUrl: "" })), false);
});

test("news update integrates digest, article, storage and safe auto publish", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const news = sampleNews();
  const deps = {
    fetchDigest: async () => ({ items: [news] }),
    fetchArticles: async () => ({ results: [news], errors: [] }),
    processAndSaveBatch: async (items, ctx) => {
      const save = ctx.repo.saveWithDedup(items[0]);
      const result = { ok: true, saved: save.saved, duplicate: false, news: items[0] };
      return { results: [result], saved: [result], duplicates: [], failed: [] };
    },
  };
  const report = await executeNewsUpdate(
    { db, repo },
    { autoPublish: true, maxPerRun: 1, articleDelayMs: 0 },
    deps
  );
  assert.equal(report.saved, 1);
  assert.equal(report.published, 1);
  assert.equal(repo.getById(news.id).publishStatus, "published");
  db.close();
});

test("updater lock prevents overlapping runs", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  let release;
  const blocked = new Promise((resolveRelease) => { release = resolveRelease; });
  const updater = createNewsUpdater(
    { db, repo },
    {
      fetchDigest: async () => { await blocked; return { items: [] }; },
      fetchArticles: async () => ({ results: [], errors: [] }),
      processAndSaveBatch: async () => ({ results: [], saved: [], duplicates: [], failed: [] }),
    }
  );
  const first = updater.run();
  const second = await updater.run();
  assert.equal(second.reason, "already_running");
  release();
  await first;
  db.close();
});

test("scheduler exposes status and supports a manual run", async () => {
  let calls = 0;
  const updater = { running: false, run: async () => ({ ok: true, calls: ++calls }) };
  const scheduler = createNewsScheduler(updater, { intervalMinutes: 60 });
  const result = await scheduler.runNow();
  assert.equal(result.calls, 1);
  assert.equal(scheduler.status().lastError, null);
  assert.equal(scheduler.start(), true);
  assert.equal(scheduler.stop(), true);
});

test("HTTP API serves only published news plus both website versions", async () => {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const published = sampleNews();
  const held = sampleNews({ id: "held-002", sourceUrl: "https://www.kitco.com/news/held-002", duplicateHash: "held-002", validationStatus: "needs_review" });
  repo.insertNews(published);
  repo.insertNews(held);
  assert.equal(repo.updatePublishStatus(published.id, "published"), true);

  const projectRoot = resolve(process.cwd(), "..");
  const server = createHttpServer({
    repo,
    projectRoot,
    siteVersion: "2",
    adminToken: "",
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  assert.equal(health.ok, true);

  // default response = envelope {items,total,limit,offset,hasMore}
  const list = await fetch(`${base}/api/news?category=gold`).then((r) => r.json());
  assert.equal(Array.isArray(list.items), true);
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].id, published.id);
  assert.equal(list.total, 1);
  assert.equal(list.hasMore, false);
  assert.equal(list.limit, 50);
  assert.equal(list.offset, 0);

  // legacy plain-array format still supported (?format=array)
  const legacy = await fetch(`${base}/api/news?category=gold&format=array`).then((r) => r.json());
  assert.equal(Array.isArray(legacy), true);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].id, published.id);

  const detail = await fetch(`${base}/api/news/${published.id}`).then((r) => r.json());
  assert.equal(detail.title, published.thaiTitle);
  assert.equal((await fetch(`${base}/api/news/${held.id}`)).status, 404);
  assert.equal((await fetch(`${base}/v1/news.html`)).status, 200);
  assert.equal((await fetch(`${base}/v2/news.html`)).status, 200);
  assert.equal(
    (await fetch(`${base}/Version-1-Premium-Dashboard/home.html`)).status,
    200
  );
  assert.equal(
    (await fetch(`${base}/Version-2-Gold-Trading/home.html`)).status,
    200
  );
  assert.equal((await fetch(`${base}/api/admin/news`)).status, 503);

  await new Promise((resolveClose) => server.close(resolveClose));
  db.close();
});
