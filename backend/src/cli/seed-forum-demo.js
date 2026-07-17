#!/usr/bin/env node
/* ============================================================
   CLI — Seed Demo Forum Data (for local UI testing ONLY)
   ------------------------------------------------------------
   ใช้งาน:  node src/cli/seed-forum-demo.js --allow-demo
            npm run forum:demo:seed

   กติกา QC:
   - ห้ามรันโดยไม่มี --allow-demo
   - ห้ามรันใน production (NODE_ENV=production)
   - idempotent: INSERT OR IGNORE (รันซ้ำไม่สร้างซ้ำ)
   - ใช้ raw SQL insert (bypass service validation) เพื่อให้ demo ID
     ที่ตั้งใจ (ft-demoXXXXXXXXXXXXXXXX) เข้า DB ได้ — แต่ยังผ่าน
     isValidContentId regex `^ft-[a-f0-9]{16}$` (prefix "demo" + hex padding)
     จึงเข้าถึงผ่าน GET /topics/:id ปกติได้
   - ทุก topic title ขึ้นต้น [DEMO], author ขึ้นต้น [DEMO]
   - ทุก body มีคำเตือน "ข้อมูลสาธิต ไม่ใช่คำแนะนำการลงทุน"
   - ลบกลับได้ด้วย clear-forum-demo.js
   ============================================================ */

import { openDb, closeDb } from "../store/db.js";
import { config } from "../config/env.js";
import { createUploadStore } from "../forum/uploadStore.js";
import { logger } from "../utils/logger.js";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

// silence noisy logs during seed
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "warn";
const log = logger.make("seed-demo");

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(here, "..", "..");
const FIXTURES_DIR = resolve(BACKEND_ROOT, "test", "fixtures", "forum-demo");

// ---------- gate ----------
if (!process.argv.includes("--allow-demo")) {
  console.error("❌ ปฏิเสธการทำงาน: ต้องส่ง --allow-demo");
  console.error("   คำสั่ง: node src/cli/seed-forum-demo.js --allow-demo");
  console.error("   หรือ:   npm run forum:demo:seed");
  process.exit(2);
}
if (process.env.NODE_ENV === "production") {
  console.error("❌ ปฏิเสธการทำงาน: ห้าม seed demo ใน production");
  process.exit(2);
}

// ---------- demo data ----------
// ID format (demo namespace — readable + idempotent):
//   topics:  demo-forum-<slug>-<seq>      เช่น demo-forum-general-001
//   posts:   demo-post-<topicseq>-<n>     เช่น demo-post-001-1
//   authors: demo-author-<n>              เช่น demo-author-1 (author ID ไม่ผ่าน isValidContentId
//                                            แต่ author ไม่มี validation ใน service)
//   attach:  demo-attach-<topicseq>-<n>
// ผ่าน isValidContentId (เพิ่ม demo namespace) + ลบได้ง่ายด้วย prefix "demo-"
const ID_COUNTER = { author: 0 };
function demoTopicId(slug, seq) {
  return `demo-forum-${slug}-${String(seq).padStart(3, "0")}`;
}
function demoAuthorId() {
  ID_COUNTER.author += 1;
  return `demo-author-${ID_COUNTER.author}`;
}
function demoPostId(topicId, seq) {
  // topicId = demo-forum-<slug>-<seq> → encode slug+seq เพื่อกัน collision
  // รูปแบบ: demo-post-<slug>-<topicseq>-<floor>
  const m = /^demo-forum-(.+)-(\d+)$/.exec(topicId);
  const slug = m ? m[1] : "x";
  const topicSeq = m ? m[2] : "000";
  return `demo-post-${slug}-${topicSeq}-${seq}`;
}
function demoAttachId(topicId, seq) {
  const m = /^demo-forum-(.+)-(\d+)$/.exec(topicId);
  const slug = m ? m[1] : "x";
  const topicSeq = m ? m[2] : "000";
  return `demo-attach-${slug}-${topicSeq}-${seq}`;
}

const DISCLAIMER = "\n\n[ข้อมูลสาธิตสำหรับทดสอบระบบ ไม่ใช่คำแนะนำการลงทุนหรือข้อเสนอซื้อขายจริง]";

const AUTHORS = [
  "[DEMO] GoldWatcher",
  "[DEMO] ChartNinja",
  "[DEMO] EAทดลอง",
  "[DEMO] NewbieTrader",
  "[DEMO] BrokerTalk",
];

// helper: now - X ms (ISO)
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const MIN = 60 * 1000, HR = 60 * MIN, DAY = 24 * HR, WEEK = 7 * DAY;

const TOPICS = [
  {
    slug: "general", seq: 1, authorIdx: 0, views: 42,
    title: "[DEMO] เช็กอินเช้าวันจันทร์: วันนี้ทุกคนมองทองอย่างไร",
    body: `สวัสดีตอนเช้าครับทุกคน เปิดสัปดาห์ใหม่ด้วยการดูแนวโน้มทองคำกันก่อน\n\nช่วงนี้ตลาดยังค่อนข้างรอข่าวเศรษฐกิจ หลายคนอาจรอจังหวะชัดเจนก่อนเข้า มาแลกเปลี่ยนมุมมองกันได้ครับ — อ่านเพื่อทำความเข้าใจเท่านั้น${DISCLAIMER}`,
    createdAt: ago(15 * MIN),
    attachFixture: null,
    replies: [
      { authorIdx: 1, body: `มองว่ายังเป็น side market อยู่ รอ breakout ก่อนครับ${DISCLAIMER}`, at: ago(10 * MIN) },
      { authorIdx: 2, body: `เห็นด้วย บางทีรอเทรดหลังข่าวชัดเจนกว่านี้${DISCLAIMER}`, at: ago(8 * MIN) },
    ],
  },
  {
    slug: "general", seq: 2, authorIdx: 3, views: 18,
    title: "[DEMO] มือใหม่ควรเริ่มจดบันทึกการเทรดแบบไหน",
    body: `อยากเริ่มจดบันทึกการเทรด แต่ไม่รู้ว่าควรเขียนอะไรบ้าง\n\nเห็นหลายคนบอกว่าการจดช่วยให้ทบทวนตัวเองได้ อยากได้คำแนะนำเริ่มต้นครับ${DISCLAIMER}`,
    createdAt: ago(2 * HR),
    attachFixture: null,
    replies: [
      { authorIdx: 0, body: `แนะนำจด 3 ส่วน: เหตุผลเข้า, ผลลัพธ์, บทเรียน ครับ${DISCLAIMER}`, at: ago(90 * MIN) },
    ],
  },
  {
    slug: "ea-indicator", seq: 1, authorIdx: 2, views: 87,
    title: "[DEMO] แชร์แนวคิด EA ทดลอง: Trend + Risk Control",
    body: `นี่คือแนวคิด EA ทดลองเท่านั้น ไม่ใช่โค้ดพร้อมใช้\n\nหลักการ: เข้าตามแนวโน้มหลัก + คุม risk ต่อไม้เข้า แบบจำกัด lot size ตามเปอร์เซ็นต์ทุน\n\nเอาไว้ศึกษา logic ไม่ใช่ให้นำไปรันจริง${DISCLAIMER}`,
    createdAt: ago(1 * DAY),
    attachFixture: "demo-ea-notes.pdf",
    replies: [
      { authorIdx: 1, body: `แนวคิด risk control น่าสนใจ ขอบคุณที่แชร์เพื่อศึกษาครับ${DISCLAIMER}`, at: ago(20 * HR) },
      { authorIdx: 4, body: `เห็นด้วยว่าจัดการ risk สำคัญที่สุด${DISCLAIMER}`, at: ago(18 * HR) },
      { authorIdx: 0, body: `เก็บไปศึกษาเพิ่มครับ${DISCLAIMER}`, at: ago(15 * HR) },
    ],
  },
  {
    slug: "ea-indicator", seq: 2, authorIdx: 1, views: 56,
    title: "[DEMO] Indicator ตัวอย่างสำหรับดูแนวโน้มหลาย Timeframe",
    body: `ตัวอย่างไอเดีย indicator ที่รวมข้อมูลหลาย timeframe ไว้ในจอเดียว\n\nเพื่อความเข้าใจเชิงตัวอย่างเท่านั้น ไม่ใช่สูตรเทรด${DISCLAIMER}`,
    createdAt: ago(3 * DAY),
    attachFixture: "demo-indicator-preview.png",
    replies: [
      { authorIdx: 2, body: `ภาพตัวอย่างช่วยให้เข้าใจ concept ขอบคุณครับ${DISCLAIMER}`, at: ago(2 * DAY) },
    ],
  },
  {
    slug: "tricks", seq: 1, authorIdx: 0, views: 124,
    title: "[DEMO] วิธีวางแผนก่อนข่าวแรงโดยไม่รีบเข้าออเดอร์",
    body: `หลายคนเสียเพราะรีบเข้าออเดอร์ตอนข่าวแรง ขอแชร์วิธีวางแผนเบื้องต้น\n\n1) รู้ประเภทข่าว 2) กำหนด zone ที่จะรอ 3) คุม risk${DISCLAIMER}`,
    createdAt: ago(1 * DAY),
    attachFixture: "demo-trading-checklist.pdf",
    replies: [
      { authorIdx: 3, body: `Checklist มีประโยชน์มากครับ ขอบคุณ${DISCLAIMER}`, at: ago(22 * HR) },
      { authorIdx: 2, body: `เห็นด้วยว่าต้องรอ zone ชัด${DISCLAIMER}`, at: ago(20 * HR) },
    ],
  },
  {
    slug: "tricks", seq: 2, authorIdx: 1, views: 73,
    title: "[DEMO] Checklist 5 ข้อก่อนกด Buy หรือ Sell",
    body: `Checklist ตัวอย่างก่อนเข้าออเดอร์ (เพื่อการทบทวนตัวเอง):\n\n1) แนวโน้มหลักชัดไหม 2) จุดเข้าสมเหตุผลไหม 3) stop อยู่ที่ไหน 4) risk เท่าไหร่ 5) มีข่าวใกล้ไหม${DISCLAIMER}`,
    createdAt: ago(3 * DAY),
    attachFixture: null,
    replies: [
      { authorIdx: 4, body: `ใช้เป็นไกด์ฝึกฝนได้ดีครับ${DISCLAIMER}`, at: ago(2 * DAY) },
    ],
  },
  {
    slug: "brokers", seq: 1, authorIdx: 4, views: 39,
    title: "[DEMO] คำถามตัวอย่างก่อนเลือกโบรกเกอร์",
    body: `คำถามตัวอย่างที่ควรถามตัวเองก่อนเลือกโบรกเกอร์\n\n- มีใบอนุญาตไหม\n- spread/fee เป็นอย่างไร\n- ฝากขั้นต่ำเท่าไหร่\n\nเพื่อการเปรียบเทียบเบื้องต้นเท่านั้น${DISCLAIMER}`,
    createdAt: ago(2 * DAY),
    attachFixture: "demo-broker-questions.pdf",
    replies: [
      { authorIdx: 0, body: `เซฟเป็น checklist เปรียบเทียบได้เลย${DISCLAIMER}`, at: ago(36 * HR) },
    ],
  },
  {
    slug: "brokers", seq: 2, authorIdx: 3, views: 28,
    title: "[DEMO] เปรียบเทียบเงื่อนไขบัญชี: สิ่งที่ควรอ่านให้ครบ",
    body: `อ่านเงื่อนไขบัญชีให้ครบก่อนตัดสินใจ — เช่นประเภทบัญชี, leverage, นโยบายถอน\n\nเป็นการแชร์ประสบการณ์เพื่อทบทวน ไม่ใช่คำแนะนำเฉพาะเจาะจง${DISCLAIMER}`,
    createdAt: ago(5 * DAY),
    attachFixture: null,
    replies: [],
  },
  {
    slug: "marketplace", seq: 1, authorIdx: 1, views: 51,
    title: "[DEMO] ตัวอย่างประกาศขาย Indicator สำหรับทดสอบ UI เท่านั้น",
    body: `⚠️ ประกาศนี้เป็นข้อมูลสาธิตเพื่อทดสอบ UI เท่านั้น — ไม่มีสินค้าจริงและไม่มีการชำระเงินจริง\n\nแสดงเพื่อให้เห็นหน้าตาประกาศในห้อง Marketplace${DISCLAIMER}`,
    createdAt: ago(4 * DAY),
    attachFixture: "demo-template.zip",
    replies: [
      { authorIdx: 2, body: `เข้าใจแล้วว่าเป็น demo ครับ${DISCLAIMER}`, at: ago(3 * DAY) },
    ],
  },
  {
    slug: "marketplace", seq: 2, authorIdx: 4, views: 34,
    title: "[DEMO] ตัวอย่างประกาศหา EA Developer สำหรับทดสอบ UI เท่านั้น",
    body: `⚠️ ประกาศนี้เป็นข้อมูลสาธิตเพื่อทดสอบ UI เท่านั้น — ไม่มีการจ้างงานจริงหรือการติดต่อจริง\n\nแสดงเพื่อให้เห็นรูปแบบประกาศใน Marketplace${DISCLAIMER}`,
    createdAt: ago(1 * WEEK),
    attachFixture: null,
    replies: [
      { authorIdx: 0, body: `เข้าใจว่าเป็น demo ครับ${DISCLAIMER}`, at: ago(6 * DAY) },
    ],
  },
];

// fixture → mime/ext mapping (ทุกนามสกุลอยู่ใน whitelist ของ forum upload)
const FIXTURE_META = {
  "demo-ea-notes.pdf": { mime: "application/pdf", ext: ".pdf" },
  "demo-indicator-preview.png": { mime: "image/png", ext: ".png" },
  "demo-trading-checklist.pdf": { mime: "application/pdf", ext: ".pdf" },
  "demo-broker-questions.pdf": { mime: "application/pdf", ext: ".pdf" },
  "demo-template.zip": { mime: "application/zip", ext: ".zip" },
};

// ---------- main ----------
async function main() {
  // show db path first
  const dbPath = config.storage.databaseUrl || "file:./data/news.db";
  console.log("📍 Demo forum seed — local/dev only");
  console.log(`   DB: ${dbPath}`);
  console.log(`   Fixtures: ${FIXTURES_DIR}`);
  console.log("");

  const db = openDb();
  const tx = db.transaction(() => seedAll(db));
  const summary = tx();

  // attachments (file storage — async I/O, ใช้ db เดียวกันก่อน close)
  const attachWritten = await seedAttachments(summary.attachmentsPlan, db);

  closeDb();

  console.log("");
  console.log("✅ Seed สำเร็จ (idempotent):");
  console.log(`   authors: ${summary.authors}  (ตัวอย่าง [DEMO] *)`);
  console.log(`   topics:  ${summary.topics}`);
  console.log(`   replies: ${summary.replies}`);
  console.log(`   attachments: ${attachWritten}  (รวมไฟล์ที่เขียน)`);
  console.log("");
  console.log("   ลบ demo: npm run forum:demo:clear");
}

function seedAll(db) {
  const now = new Date().toISOString();
  let authorsInserted = 0;
  let topicsInserted = 0;
  let repliesInserted = 0;
  const attachmentsPlan = [];

  // authors (idempotent)
  const authorIdByName = {};
  for (const name of AUTHORS) {
    const id = demoAuthorId();
    const token = "demo-token-" + randomBytes(16).toString("hex");
    const info = db
      .prepare(
        `INSERT OR IGNORE INTO forum_authors
           (id, anon_token, display_name, kind, account_id, created_at, updated_at)
         VALUES (?, ?, ?, 'guest', NULL, ?, ?)`
      )
      .run(id, token, name, now, now);
    if (info.changes > 0) authorsInserted++;
    authorIdByName[name] = id;
  }

  // topics + replies (idempotent)
  for (const t of TOPICS) {
    const topicId = demoTopicId(t.slug, t.seq);
    const authorName = AUTHORS[t.authorIdx];
    const authorId = authorIdByName[authorName];
    const isMarket = t.slug === "marketplace" ? 1 : 0;
    const topicInfo = db
      .prepare(
        `INSERT OR IGNORE INTO forum_topics
           (id, category_slug, author_id, title, body, is_marketplace,
            moderation, pinned, view_count, reply_count, last_activity_at,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, 'visible', 0, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        topicId, t.slug, authorId, t.title, t.body, isMarket,
        t.views, 0, /* reply_count จะ sync ตอน insert reply ด้วย raw UPDATE */
        t.createdAt, t.createdAt, t.createdAt
      );
    if (topicInfo.changes > 0) topicsInserted++;

    // replies
    let floor = 0;
    for (const r of t.replies) {
      floor++;
      const postId = demoPostId(topicId, floor);
      const replyAuthorName = AUTHORS[r.authorIdx];
      const replyAuthorId = authorIdByName[replyAuthorName];
      const postInfo = db
        .prepare(
          `INSERT OR IGNORE INTO forum_posts
             (id, topic_id, author_id, body, moderation, floor, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, 'visible', ?, ?, ?, NULL)`
        )
        .run(postId, topicId, replyAuthorId, r.body, floor, r.at, r.at);
      if (postInfo.changes > 0) {
        repliesInserted++;
        // sync reply_count + last_activity_at (raw UPDATE — bypass service)
        db.prepare(
          `UPDATE forum_topics
             SET reply_count = (SELECT COUNT(*) FROM forum_posts WHERE topic_id = ? AND deleted_at IS NULL),
                 last_activity_at = MAX(last_activity_at, ?)
           WHERE id = ?`
        ).run(topicId, r.at, topicId);
      }
    }

    // attachment plan (file write ทำใน seedAttachments นอก tx)
    if (t.attachFixture && FIXTURE_META[t.attachFixture]) {
      attachmentsPlan.push({
        topicId,
        authorId,
        fixture: t.attachFixture,
        seq: attachmentsPlan.length + 1,
      });
    }
  }

  return {
    authors: authorsInserted,
    topics: topicsInserted,
    replies: repliesInserted,
    attachments: attachmentsPlan.length,
    attachmentsPlan,
  };
}

async function seedAttachments(plan, db) {
  if (!plan.length) return;
  // uploadStore ต้องการ absolute uploadDir (เหมือน server.js)
  const raw = config.forum.uploadDir || "data/forum";
  const uploadDir = raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)
    ? raw
    : resolve(BACKEND_ROOT, raw);
  const store = createUploadStore({ uploadDir, maxBytes: 5 * 1024 * 1024, maxFiles: 4 });

  const now = new Date().toISOString();
  let count = 0;

  for (const item of plan) {
    const meta = FIXTURE_META[item.fixture];
    if (!meta) continue;
    let buffer;
    try {
      buffer = readFileSync(resolve(FIXTURES_DIR, item.fixture));
    } catch {
      log.warn(`fixture missing: ${item.fixture} — skip`);
      continue;
    }
    // idempotent: ถ้ามี attachment row สำหรับ owner นี้อยู่แล้ว → skip
    const exist = db
      .prepare("SELECT COUNT(*) AS n FROM forum_attachments WHERE owner_type='topic' AND owner_id=? AND original_name=?")
      .get(item.topicId, item.fixture);
    if (exist && exist.n > 0) continue;

    const saved = await store.save({ buffer, ext: meta.ext, mime: meta.mime });
    const attachId = demoAttachId(item.topicId, item.seq);
    db.prepare(
      `INSERT OR IGNORE INTO forum_attachments
         (id, owner_type, owner_id, author_id, original_name, stored_name,
          stored_path, mime_type, byte_size, created_at)
       VALUES (?, 'topic', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      attachId, item.topicId, item.authorId,
      item.fixture, saved.storedName, saved.storedPath,
      meta.mime, saved.byteSize, now
    );
    count++;
  }
  console.log(`   📎 attachments written: ${count}`);
  return count;
}

main().catch((err) => {
  console.error("❌ seed ล้มเหลว:", err.message);
  console.error(err.stack);
  process.exit(1);
});
