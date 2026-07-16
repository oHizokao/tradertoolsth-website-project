import { resolve } from "node:path";
import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createHttpServer, listen } from "../src/api/server.js";

const db = createTestDb();
const repo = createNewsRepository(db);
const now = new Date().toISOString();
const news = {
  id: "browser-gold-news",
  source: "Kitco News",
  sourceUrl: "https://www.kitco.com/news/article/2026-07-15/gold-market-update",
  originalTitle: "Gold market reacts to the latest US inflation data",
  originalAuthor: "Kitco News",
  originalPublishedAt: now,
  category: "Latest Metals News",
  originalContent: "Gold prices moved after the latest United States inflation report. ".repeat(8),
  thaiTitle: "ทองคำเคลื่อนไหว หลังตลาดประเมินข้อมูลเงินเฟ้อสหรัฐล่าสุด",
  thaiSummary: "ราคาทองคำผันผวน ขณะที่นักลงทุนประเมินแนวโน้มดอกเบี้ยและทิศทางเงินดอลลาร์หลังตัวเลขเงินเฟ้อชุดใหม่",
  thaiContent: [
    "ราคาทองคำเคลื่อนไหวตามการเปลี่ยนแปลงของค่าเงินดอลลาร์และอัตราผลตอบแทนพันธบัตร หลังตลาดรับรู้ข้อมูลเงินเฟ้อสหรัฐชุดล่าสุด",
    "นักลงทุนยังติดตามถ้อยแถลงของธนาคารกลางสหรัฐ เพื่อประเมินจังหวะการปรับนโยบายการเงินในระยะถัดไป",
    "เนื้อหานี้เป็นการสรุปข้อเท็จจริงเพื่อให้เข้าใจภาพตลาด ไม่ใช่คำแนะนำในการซื้อหรือขายสินทรัพย์",
  ],
  marketFactors: "เงินเฟ้อสหรัฐ • แนวโน้มดอกเบี้ย • ค่าเงินดอลลาร์",
  keyFacts: ["ทองคำผันผวนตามข้อมูลเงินเฟ้อ", "ตลาดติดตามแนวโน้มดอกเบี้ย"],
  mentionedNumbers: [],
  credit: "เรียบเรียงจาก Kitco News",
  imageUrl: "https://images.pexels.com/photos/47047/gold-ingots-golden-treasure-47047.jpeg?auto=compress&cs=tinysrgb&w=1200",
  imageSource: "Pexels",
  imageAuthor: "Pixabay",
  imageAuthorUrl: "https://www.pexels.com/@pixabay",
  imageLicense: "Pexels License",
  imageSourceUrl: "https://www.pexels.com/photo/close-up-of-gold-bars-47047/",
  imageSearchKeywords: ["gold bars market"],
  imageStatus: "selected",
  imageReviewRequired: false,
  validationStatus: "validated",
  publishStatus: "processing",
  aiConfidence: 94,
  aiValidation: { isValid: true },
  duplicateHash: "browser-fixture-gold",
  sourcePolicy: "trusted",
  sourcePolicyReason: "kitco_allowlist",
  topics: ["gold", "inflation", "fed"],
  section: "Latest Metals News",
  teaser: "Gold market update",
  isExternal: false,
  pipelineNote: "browser_fixture",
  createdAt: now,
  updatedAt: now,
  validatedAt: now,
  publishedAt: null,
};

repo.insertNews(news);
repo.updatePublishStatus(news.id, "published");

const projectRoot = resolve(process.cwd(), "..");
const server = createHttpServer({ repo, projectRoot, siteVersion: "2", adminToken: "" });
const port = Number(process.env.E2E_PORT || 4317);
await listen(server, { host: "127.0.0.1", port });
console.log(`E2E_READY http://127.0.0.1:${port}`);

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
