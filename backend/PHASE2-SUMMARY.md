# Phase 2 — สรุปงาน Kitco Scraper

> ระบบข่าวอัตโนมัติ TraderToolsTH — **Phase 1 + Phase 2 + QC fixes**
> หัวหน้าโปรเจกต์: Codex (QC) · ผู้พัฒนา: GLM Agent
> วันที่อัปเดตล่าสุด: 2026-07-14

---

## 🎯 สถานะปัจจุบัน

| Phase | สถานะ | หมายเหตุ |
|-------|-------|---------|
| **Phase 1** — ตรวจโปรเจกต์ | ✅ ผ่าน QC | รายงานโครงสร้าง + แผน + ความเสี่ยง |
| **Phase 2** — Scraper | ✅ ผ่าน QC (หลังแก้ 3 จุด) | dedupe + age filter + รวม label |
| Phase 3 — OpenAI | ⏳ รออนุมัติ | เรียบเรียงข่าวภาษาไทย |
| Phase 4 — Pexels | ⏳ รออนุมัติ | ค้นภาพ + license |
| Phase 5 — Storage + Scheduler | ⏳ รอ | บันทึก + ตั้งเวลา + publish lock |
| Phase 6 — Frontend | ⏳ รอ | เชื่อม V1/V2 |
| Phase 7 — ทดสอบ | ⏳ รอ | E2E + กรณีล้มเหลว |

---

## ✅ ที่ทำเสร็จแล้ว

### Phase 1 (ตรวจโปรเจกต์)
- ตรวจพบว่าโปรเจกต์เป็น **Static site 2 เวอร์ชัน** (V1 + V2) ไม่มี Backend
- พบว่า `services/news.service.js` มี `API_ENDPOINT = null` — **พร้อมเชื่อม API โดยไม่พัง UI**
- ตรวจ Runtime: Node 22 + npm + Python + git พร้อม
- ระบุความเสี่ยงสูงสุด: **ไม่มี `.gitignore`** (กัน secret)

### Phase 2 (Scraper)
- สร้าง `.gitignore` ที่ root + backend (กัน `.env`, `node_modules/`, `data/`, `*.db`)
- สร้าง `backend/` skeleton แยกจาก Frontend โดยสิ้นเชิง
- เขียน Kitco Scraper รุ่นแรก — **ดึงข่าวได้จริงจาก Kitco News Digest**
- ระบบ Duplicate Detection (5 ชั้น)
- CLI ทดสอบ 4 โหมด

### QC fixes (3 จุดที่ Codex พบ)
1. ✅ **`fetchDigest()` เรียก `dedupeList()` ก่อน return** — คืนเฉพาะ accepted
2. ✅ **เพิ่ม `maxAgeHours` (default 48)** — ข่าวเก่าถูกตัด, อ่านวันที่ไม่ได้ → `needsReview`
3. ✅ **รวม query ที่ label เดียวกันก่อน** คำนวณ raw/relevant/fresh

---

## 🏗️ สถาปัตยกรรมปัจจุบัน

```
Tradertoolsth Website/
├── .gitignore                          ← กัน secret + ข่าวดิบ
├── index.html                          ← ส่งต่อไปยังหน้า Home ของ Version 2
├── Version-2-Gold-Trading/             ← Static site (เว็บไซต์หลัก)
└── backend/                            ← สร้างใหม่ทั้งหมด

หมายเหตุ (อัปเดต 16 ก.ค. 2026): Version-1-Premium-Dashboard ถูกนำออกจากระบบแล้ว
ส่วน backup เก็บไว้ที่ backup/version-1-before-removal-20260716/ โปรเจกต์ใช้เฉพาะ Version 2
    ├── package.json                    (Node 22+, dep: cheerio)
    ├── .env.example                    (ทุก env var + default)
    ├── .gitignore
    └── src/
        ├── config/env.js               ← อ่าน env (ไม่มี default secret)
        ├── utils/
        │   ├── logger.js               ← redact api_key/secret/token
        │   ├── httpClient.js           ← timeout + retry + backoff
        │   ├── hash.js                 ← sha256 + normalize + title similarity
        │   ├── date.js                 ← parseKitcoDate + checkAge
        │   ├── schema.js               ← createEmptyNews (ครบทุกฟิลด์)
        │   └── filter.js               ← isRelevant + tagTopic
        ├── store/duplicate.js          ← buildIndex + checkDuplicate + dedupeList
        ├── scraper/kitco.scraper.js    ← fetchDigest + fetchArticle + fetchArticles
        └── cli/test-scrape.js          ← CLI ทดสอบ
```

### ไฟล์ทั้งหมด (14 ไฟล์, 1,271 บรรทัด)

| ไฟล์ | บรรทัด | หน้าที่ |
|------|------:|--------|
| `src/scraper/kitco.scraper.js` | 434 | Scraper หลัก (ดึง list + เปิดบทความ) |
| `src/cli/test-scrape.js` | 237 | CLI ทดสอบ 4 โหมด |
| `src/store/duplicate.js` | 121 | Duplicate detection 5 ชั้น |
| `src/utils/httpClient.js` | 83 | HTTP + timeout/retry |
| `src/config/env.js` | 79 | อ่าน env var |
| `src/utils/filter.js` | 72 | กรอง relevant + tag topic |
| `src/utils/hash.js` | 72 | sha256 + similarity |
| `src/utils/schema.js` | 69 | News schema |
| `src/utils/logger.js` | 53 | Logger + redact |
| `src/utils/date.js` | 51 | Date parsing + age check |

---

## 🔧 วิธี Scraper ทำงาน

### Pipeline ดึงข่าว (fetchDigest)

```
HTTP GET https://www.kitco.com/news/digest
  ↓
ดึง <script id="__NEXT_DATA__"> จาก HTML (Next.js SSR)
  ↓
parse dehydratedState.queries (5 query types)
  ↓
SECTION_RESOLVERS แมป queryKey → section label:
  • newsByCategoryGeneric → Market News / Mining
  • digestLatestNews      → Latest Metals News
  • digestStreetTalk      → Street Talk
  • newsOTWList           → Off The Wire
  ↓
★ รวม items จาก query ที่ label เดียวกัน (QC fix #3)
  ↓
normalizeItem() — รวม 4 รูปแบบ item เป็นมาตรฐานเดียว
  ↓
isRelevant() — กรองเฉพาะ keyword (gold/silver/fed/cpi/inflation/...)
  ↓
checkAge() — กรองข่าวเก่า > maxAgeHours (QC fix #2)
             อ่านวันที่ไม่ได้ → needsReview
  ↓
limit per-section (maxPerSection)
  ↓
★ dedupeList() — dedupe ข้าม section ทั้งหมด (QC fix #1)
  ↓
คืน accepted เท่านั้น (ไม่มี URL ซ้ำ)
```

### Pipeline เปิดบทความเต็ม (fetchArticle)

```
fetchArticle(item)
  ↓
item.isExternal? (Street Talk = ลิงก์เว็บอื่น)
  ├─ ใช่ → เก็บ metadata อย่างเดียว ไม่ดึงเนื้อหา
  └─ ไม่ → ดึง __NEXT_DATA__ ของหน้า article
            ↓
            articleData.bodyWithEmbeddedMedia.value (HTML)
            ↓
            cleanBodyHtml() — cheerio ลบ script/ad/related → plain text
            ↓
            สร้าง News object (status: fetched)
```

### การหยุดปลอดภัย
- ไม่พบ `__NEXT_DATA__` หรือ `articleData` → โยน `StructureError` → **หยุด scrape ทันที**
- ไม่เงียบผ่าน — บังคับให้คนมาตรวจสอบเมื่อ Kitco เปลี่ยนโครงสร้าง

---

## 📊 ผลทดสอบล่าสุด

คำสั่ง: `node src/cli/test-scrape.js --max 3 --open 2`

### สถิติ pipeline

```
raw (รวมทุก section)    : 240
relevant (ผ่าน filter)   : 82
fresh (ผ่าน age <48h)    : 30
ก่อน dedupe              : 12
หลัง dedupe (ACCEPTED)   : 8
ข่าวซ้ำที่ตัด             : 4
ข่าวเก่าถูกตัด            : 52
อ่านวันที่ไม่ได้ (review)  : 0
URL ซ้ำในผลลัพธ์สุดท้าย   : 0 ✅
```

### สถิติต่อ section (label รวมแล้ว)

| section | raw | relevant | fresh | agedOut | noDate |
|---------|----:|---------:|------:|--------:|-------:|
| Market News | 80 | 39 | 7 | 32 | 0 |
| Mining | 40 | 9 | 4 | 5 | 0 |
| Off The Wire | 40 | 18 | 8 | 10 | 0 |
| Street Talk | 40 | 0 | 0 | 0 | 0 |
| Latest Metals News | 40 | 16 | 11 | 5 | 0 |
| **TOTAL** | **240** | **82** | **30** | **52** | **0** |

### ผลเปิดบทความเต็ม

```
[1] Gold and silver rally as CPI cools Fed-rate pressure
    author=Kitco NewsWire | 3,603 chars | hash=0256f5ac6870fb41
[2] Gold prices surging higher to test resistance at $4,100
    author=Neils Christensen | 3,726 chars | hash=ac8c499036b1e2b8
เวลารวม: 3.4s
```

---

## 🚀 วิธีรัน

```bash
cd "C:\Users\UsEr\Desktop\Codex\Tradertoolsth Website\backend"

# ติดตั้ง dependency (ครั้งแรกเท่านั้น)
npm install

# ตรวจ syntax ทุกไฟล์
npm run check

# ทดสอบดึงรายการข่าว
node src/cli/test-scrape.js                  # default
node src/cli/test-scrape.js --max 3          # จำกัด 3/section
node src/cli/test-scrape.js --sections       # ดูเฉพาะสถิติ

# ทดสอบเปิดบทความเต็ม
node src/cli/test-scrape.js --max 3 --open 2
node src/cli/test-scrape.js --article <URL>  # เปิดบทความเดี่ยว
```

---

## 🔐 ความปลอดภัย

| ข้อ | สถานะ |
|------|-------|
| `.gitignore` กัน `.env` ติด git | ✅ |
| `.gitignore` กัน `node_modules/`, `data/`, `*.db` | ✅ |
| `.gitignore` กัน cache HTML (`_kitco_*.html`, `_nextdata.json`) | ✅ |
| Logger redact field `api_key/secret/token` อัตโนมัติ | ✅ |
| สแกน tracked files ไม่พบ secret | ✅ |
| API key อยู่ใน `.env` เท่านั้น (Phase 2 ยังไม่ใช้) | ✅ |

---

## 📋 Environment Variables

### Phase 2 (ปัจจุบัน — ไม่ต้องตั้งค่าอะไร)
ทุกค่ามี default ปลอดภัย รันได้เลย

### สำหรับ Phase ถัดไป (เตรียมไว้ใน `.env.example`)

```env
OPENAI_API_KEY=              # Phase 3 — เรียบเรียงข่าว
OPENAI_TEXT_MODEL=gpt-4o-mini
PEXELS_API_KEY=              # Phase 4 — ค้นภาพ
DATABASE_URL=file:./data/news.db
NEWS_INTERVAL_MINUTES=60

# Scraper tuning
KITCO_MAX_PER_SECTION=20
KITCO_MAX_AGE_HOURS=48
KITCO_ARTICLE_DELAY_MS=1500
KITCO_HTTP_TIMEOUT_MS=20000
KITCO_HTTP_RETRIES=2
```

---

## 💰 ค่าใช้จ่าย

**Phase 2: 0 บาท** — ยังไม่เรียก API ที่เสียเงิน (ไม่ใช้ OpenAI/Pexels)

---

## ⚠️ หมายเหตุที่ควรทราบ

1. **Street Talk relevant = 0** ในบางรอบ — เพราะส่วนใหญ่เป็นลิงก์ข่าว crypto/bitcoin จากเว็บอื่น ไม่ตรง keyword ที่กรอง (gold/silver/fed/...) **ไม่ใช่ bug**
2. **Kitco เป็น Next.js SSR** — เลือกดึงจาก `__NEXT_DATA__` แทน Playwright เพราะเร็วกว่ามากและได้ข้อมูลครบ (HTML ส่งมาแบบ server-rendered)
3. **External link (Street Talk)** เป็นลิงก์ aggregator ของเว็บอื่น → เก็บ metadata อย่างเดียว ไม่ดึงเนื้อหาต้นทาง (กัน ToS/ลิขสิทธิ์)
4. **dedupe ทำหลัง limit per-section** — เพื่อกัน section ใหญ่กีดกัน section เล็กก่อน dedupe

---

## 🚫 ข้อห้าม (ตามกฎโปรเจกต์)

- ❌ ห้ามใช้ Firecrawl
- ❌ ห้ามใช้ Google Images
- ❌ ห้ามใช้รูปจาก Kitco
- ❌ ห้ามคัดลอกบทความตรงๆ
- ❌ ห้ามแปลบทความตรงตัว
- ❌ ห้ามเลือกเองว่าจะใช้ V1 หรือ V2
- ❌ ห้ามแก้ดีไซน์โดยไม่ได้รับคำสั่ง
- ❌ ห้ามใส่ API Key ใน Git
- ❌ ห้ามเผยแพร่ข่าวที่ตรวจไม่ผ่าน
- ❌ ห้ามสร้างข้อมูลหรือตัวเลขปลอม
- ❌ ห้ามเผยแพร่คำแนะนำการลงทุนแบบรับประกันผล

ทั้งหมดนี้ถูกเคารพในทุกขั้นตอนของ Phase 2

---

## 🎯 ขั้นถัดไป (Phase 3 — รอ Codex อนุมัติ)

เมื่อ Codex อนุมัติ Phase 3 จะทำ:
1. สร้าง `backend/src/ai/` — OpenAI client (config จาก env)
2. เรียบเรียงข่าว EN → ภาษาไทย (ไม่แปลตรง ไม่คัดลอก)
3. สร้างหัวข้อ + Summary (2-3 บรรทัด)
4. แยก keyFacts + mentionedNumbers
5. ตรวจตัวเลขไทย vs ต้นทาง
6. ตรวจคำต้องห้าม ("ขึ้นแน่", "กำไรแน่นอน", ...)
7. สร้าง image keywords
8. คำนวณ aiConfidence
9. ใส่เครดิต: `อ้างอิงข้อมูลจาก Kitco News — เรียบเรียงใหม่โดย TraderToolsTH`
10. Cost tracking + retry/timeout

**ค่าใช้จ่ายโดยประมาณ Phase 3** (ต่อข่าว):
- 1 บทความ ~3,500 chars EN → gpt-4o-mini
- ประมาณ 1,500-2,000 tokens input + 1,500 tokens output
- ≈ $0.0008-0.0012/ข่าว (≈ 0.03-0.04 บาท/ข่าว)
