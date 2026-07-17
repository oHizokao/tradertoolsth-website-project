#!/usr/bin/env node
/* ============================================================
   CLI — Clear Demo Forum Data (delete ONLY demo records)
   ------------------------------------------------------------
   ใช้งาน:  node src/cli/clear-forum-demo.js --allow-demo
            npm run forum:demo:clear

   กติกา QC:
   - ห้ามรันโดยไม่มี --allow-demo
   - ห้ามรันใน production (NODE_ENV=production)
   - ลบเฉพาะ demo records เท่านั้น:
       * topics: id LIKE 'ft-demo%'
       * posts:   id LIKE 'fp-demo%'
       * attachments: id LIKE 'fa-dat%' (demo) + ลบไฟล์จริง
       * authors: display_name LIKE '[DEMO]%'
   - ห้ามกระทบข้อมูลจริง (id ไม่ใช่ demo prefix / author ไม่ใช่ [DEMO])
   - ก่อนลบไฟล์ attachment ตรวจ path traversal + ตรวจว่าเป็น path ของ demo เท่านั้น
   ============================================================ */

import { openDb, closeDb } from "../store/db.js";
import { config } from "../config/env.js";
import { createUploadStore } from "../forum/uploadStore.js";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";

process.env.LOG_LEVEL = process.env.LOG_LEVEL || "warn";
const log = logger.make("clear-demo");

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(here, "..", "..");

// ---------- gate ----------
if (!process.argv.includes("--allow-demo")) {
  console.error("❌ ปฏิเสธการทำงาน: ต้องส่ง --allow-demo");
  console.error("   คำสั่ง: node src/cli/clear-forum-demo.js --allow-demo");
  console.error("   หรือ:   npm run forum:demo:clear");
  process.exit(2);
}
if (process.env.NODE_ENV === "production") {
  console.error("❌ ปฏิเสธการทำงาน: ห้ามลบ demo ใน production");
  process.exit(2);
}

async function main() {
  const dbPath = config.storage.databaseUrl || "file:./data/news.db";
  console.log("📍 Demo forum clear — local/dev only");
  console.log(`   DB: ${dbPath}`);
  console.log("");

  const db = openDb();

  // 1) ดึง demo attachment rows ก่อนลบ (เพื่อลบไฟล์จริง)
  //    รองรับทั้ง readable IDs (demo-attach-*) และ legacy (fa-dat*/fa-datt*)
  const demoAttachments = db
    .prepare(
      `SELECT id, stored_path, original_name FROM forum_attachments
       WHERE id LIKE 'demo-attach%' OR id LIKE 'fa-dat%' OR original_name LIKE 'demo-%'`
    )
    .all();

  // 2) ลบ demo data (transaction) — ลำดับตาม FK dependency:
  //    posts → attachments → topics → authors
  //    รองรับทั้ง readable IDs (demo-forum-*, demo-post-*, demo-author-*)
  //    และ legacy counter IDs (ft-demo*, fp-demo*, fa-demo*)
  const tx = db.transaction(() => {
    // posts ที่อ้าง topic demo (ลบก่อนเพราะ FK → topics)
    const posts = db
      .prepare(
        `DELETE FROM forum_posts
         WHERE id LIKE 'demo-post%' OR id LIKE 'fp-demo%'
            OR topic_id LIKE 'demo-forum-%' OR topic_id LIKE 'ft-demo%'`
      )
      .run().changes;
    // attachments demo rows (ลบก่อน topics เพราะ owner_id=topic; ไฟล์จริงลบนอก tx)
    const attachRows = db
      .prepare(
        `DELETE FROM forum_attachments
         WHERE id LIKE 'demo-attach%' OR id LIKE 'fa-dat%' OR original_name LIKE 'demo-%'`
      )
      .run().changes;
    // topics demo
    const topics = db
      .prepare("DELETE FROM forum_topics WHERE id LIKE 'demo-forum-%' OR id LIKE 'ft-demo%'")
      .run().changes;
    // authors demo (ลดท้าย — หลัง topic/post/attach ที่อ้าง author_id ถูกลบหมดแล้ว)
    const authors = db
      .prepare(
        `DELETE FROM forum_authors
         WHERE id LIKE 'demo-author-%' OR id LIKE 'fa-demo%' OR display_name LIKE '[DEMO]%'`
      )
      .run().changes;
    return { posts, attachRows, topics, authors };
  });
  const summary = tx();

  closeDb();

  // 3) ลบไฟล์ demo attachments จริง (ใช้ uploadStore สำหรับ path-safe removal)
  let filesRemoved = 0;
  if (demoAttachments.length) {
    const raw = config.forum.uploadDir || "data/forum";
    const uploadDir = raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)
      ? raw
      : resolve(BACKEND_ROOT, raw);
    const store = createUploadStore({ uploadDir });
    for (const att of demoAttachments) {
      try {
        await store.removeStored(att.stored_path);
        filesRemoved++;
      } catch (err) {
        log.warn(`could not remove demo file ${att.stored_path}: ${err.message}`);
      }
    }
  }

  console.log("✅ Clear สำเร็จ (เฉพาะ demo เท่านั้น):");
  console.log(`   demo topics deleted:      ${summary.topics}`);
  console.log(`   demo posts deleted:       ${summary.posts}`);
  console.log(`   demo attachments rows:    ${summary.attachRows}`);
  console.log(`   demo attachment files:    ${filesRemoved}`);
  console.log(`   demo authors deleted:     ${summary.authors}`);
  console.log("");
  console.log("   ข้อมูลจริง (id ปกติ / author ไม่ใช่ [DEMO]) ไม่ถูกกระทบ");
}

main().catch((err) => {
  console.error("❌ clear ล้มเหลว:", err.message);
  console.error(err.stack);
  process.exit(1);
});
