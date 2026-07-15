# Phase 8 — ข่าวล่าสุดจริงจาก Kitco (sourcePublishedAt)

อัปเดตล่าสุด: 15 กรกฎาคม 2026

เอกสารนี้สรุปการพัฒนา Phase 8 ตามข้อกำหนด "ข่าวล่าสุดจริงจาก Kitco" ทั้งหมด
รวมผลการทดสอบจริงของ `npm run check`, `npm test`, และ `npm run scrape:verify`

---

## หลักการสำคัญ (No Fallback Policy)

ทุกชั้นของระบบใช้ `sourcePublishedAt` เท่านั้น — ห้าม fallback ไป `createdAt`/`publishedAt`
ของระบบ ข่าวที่ไม่มี `sourcePublishedAt` จะถูกตัดออกจาก public listing หรือส่ง `needs_review`

| ชั้น | ห้าม | ทำแทน |
|------|------|-------|
| SQL ORDER BY | `COALESCE(..., published_at, created_at)` | `source_published_at DESC` + `WHERE NOT NULL` |
| Repo listing | คืนข่าวที่ไม่มี sourcePublishedAt | กรองออก (`WHERE source_published_at IS NOT NULL`) |
| publicNews `publishedAt` | fallback ไป createdAt/publishedAt | `sourcePublishedAt` เท่านั้น (null ก็ null) |
| Migration | copy `originalPublishedAt` ทุกค่า | validate parse ก่อน copy; ไม่ผ่าน → NULL + needs_review |
| Scraper | เดาเวลา | null + needsReview |

---

## การตรวจสอบแหล่งข้อมูล Kitco จริง

ก่อนพัฒนา ตรวจสอบ Kitco จริง (15 ก.ค. 2026) พบว่า:
- ทั้ง list (`__NEXT_DATA__` queries) และ article page ใช้ field **`createdAt`** เป็นเวลาเผยแพร่จริง
- รูปแบบ: `2026-07-15T09:59:00-0400` (ISO offset ไม่มีโคลอน, timezone ET)
- ไม่มี JSON-LD `datePublished` หรือ meta date tag ที่ parse ได้
- ดังนั้น `createdAt` คือแหล่งที่เชื่อถือได้ที่สุดและเดียว

`extractSourcePublishedAt()` อ่าน field หลายชื่อตามลำดับ:
`createdAt → publishedAt → datePublished → publishDate → timestamp`

---

## สิ่งที่พัฒนา

### Backend
1. **Date utilities** (`src/utils/date.js`): `extractSourcePublishedAt`, `toUtcIso`, `toBangkokString`
2. **Database schema**: เพิ่มคอลัมน์ `source_published_at` + index
   - ALTER TABLE idempotent (PRAGMA table_info check) ใน `db.js`
   - Migration validate ก่อน copy: parse `originalPublishedAt` ก่อน ผ่านเท่านั้นจึง copy;
     ไม่ผ่าน → NULL + `validation_status='needs_review'`
3. **Schema/Mapper/Repository**: เพิ่ม field + เปลี่ยน ORDER BY เป็น `source_published_at DESC`
   + `WHERE source_published_at IS NOT NULL` (ไม่มี COALESCE fallback)
4. **Scraper** (`src/scraper/kitco.scraper.js`):
   - `normalizeItem`/`fetchArticle` เซ็ต `sourcePublishedAt` (ISO UTC canonical)
   - export ใหม่ `selectTopNews(items, n)`: เลือก N ล่าสุดตาม sourcePublishedAt
     (หลัง dedupe + filter) แยกข่าวที่ไม่มี sourcePublishedAt ไป `needsReview`
5. **Pipeline** (`src/pipeline/runNewsUpdate.js`): ใช้ `selectTopNews` เลือก candidates
   แทนการวนลูปตามลำดับ scrape; ข่าวที่ไม่มี sourcePublishedAt บันทึกเป็น `needs_review`
6. **publicNews.js**: `publishedAt` = `sourcePublishedAt` เท่านั้น; เพิ่ม `sourcePublishedAtLabel`
   ("เผยแพร่เมื่อ ...") + `importedAt` (เวลานำเข้าระบบ แยกจากตัวเรียง)
7. **CLI verify** (`src/cli/verify-news.js`): `npm run scrape:verify` — ดึง digest สดจาก Kitco,
   เลือก 3 ล่าสุด, แสดง title/sourceUrl/sourcePublishedAt รายรายการ, ตรวจ PASS/FAIL

### Frontend (V1 + V2)
- `helpers.js`: เพิ่ม `formatBangkok(iso)` → "เผยแพร่เมื่อ ..." + `formatImported(iso)`
- `cards.js` newsCard: แสดง `formatBangkok(sourcePublishedAt)` แทน `formatTime(publishedAt)`
- `news-detail.js`: "เผยแพร่เมื่อ ..." (sourcePublishedAt) + แยก "นำเข้าระบบ ..." (importedAt)
- `news.js` V1: เขียนใหม่ให้มีโครง "3 ข่าวล่าสุด + ข่าวเพิ่มเติม" เหมือน V2 (เดิมเป็น flat list)
- `home.js` V1: แก้ bug `fetchNews("all", 3)` → `fetchNews("all", {limit:3})` + ใช้ `formatBangkok`

### Tests
- `test/phase8.test.js` (ใหม่): 13 tests ครอบคลุม AC ทั้ง 6 ข้อ + helper tests + pagination
- `test/phase7.test.js`: `makeNews` เพิ่ม `sourcePublishedAt`; แก้ fallback test เป็น no-fallback
- `test/phase6.test.js`: `sampleNews` เพิ่ม `sourcePublishedAt`
- `test/phase5.test.js`: restart-persistence test ใช้ `__runMigrationsOn` (รวม ALTER Phase 8)

---

## ผลการทดสอบจริง

### 1. `npm run check` — syntax check ทุกไฟล์
```
EXIT=0
syntax OK
```
ครอบคลุม 27 ไฟล์รวม `verify-news.js` ใหม่

### 2. `npm test` — test suite ทั้งหมด
```
# tests 192
# pass 192
# fail 0
```
**192 passed, 0 failed** (phase3-8 รวม phase8 ใหม่ 18 tests — เพิ่ม QC3a-QC3e 5 tests)

### 3. `npm run scrape:verify` — ตรวจสอบข่าวที่ scraper ดึงจาก Kitco

**ขอบเขตสำคัญ:** คำสั่งนี้ตรวจเฉพาะข้อมูลที่ scraper ดึงมาเอง (AUTOMATED CHECKS)
ไม่ใช่การเปรียบเทียบกับแหล่งอิสระแยกจาก scraper การยืนยันว่า scraper อ่าน
field ถูกต้องเทียบกับหน้า Kitco จริงต้องทำ MANUAL VERIFICATION แยก

#### AUTOMATED CHECKS (ที่ CLI ตรวจเองได้)
```
✅ PASS (AUTOMATED) — 3 ข่าวมี title/sourceUrl/sourcePublishedAt ครบ
   และเรียงใหม่→เก่าถูกต้อง
```
CLI ตรวจ 4 ข้อภายในข้อมูลที่ดึงมา:
- A) ได้ครบ 3 ข่าว
- B) ทุกข่าวมี title + sourceUrl + sourcePublishedAt ครบ
- C) ไม่มี sourceUrl ซ้ำกัน
- D) sourcePublishedAt เรียงใหม่ → เก่า ถูกต้อง

#### MANUAL VERIFICATION (ที่ต้องทำด้วยตา/บันทึกหลักฐานแยก)
เปรียบเทียบ 3 ข่าวแรกจาก scraper กับหน้า Kitco Digest/Latest News จริง
โดยเปิด https://www.kitco.com/news/digest ด้วยตา ผลการตรวจ (15 ก.ค. 2026):

| # | scraper ดึงมา (sourcePublishedAt UTC) | Kitco จริง (createdAt ดิบ) | ตรง? |
|---|----------------------------------------|----------------------------|------|
| 1 | Silver's stubborn supply deficits... `15:36:55Z` | `11:36:55-0400` = `15:36:55Z` | ✅ title+URL+time |
| 2 | Gold holding steady as Bank of Canada... `13:59:00Z` | `09:59:00-0400` = `13:59:00Z` | ✅ title+URL+time |
| 3 | Gold steadies above $4,000 as PPI cools... `13:02:00Z` | `09:02:00-0400` = `13:02:00Z` | ✅ title+URL+time |

> หมายเหตุ: ตารางนี้คือผล MANUAL VERIFICATION ที่ทำด้วยตาเทียบกับหน้า Kitco
> ไม่ใช่ผลอัตโนมัติของ `scrape:verify` CLI ใช้ยืนยันเฉพาะวันที่ตรวจ (15 ก.ค. 2026) เท่านั้น
> หากต้องการตรวจซ้ำในวันอื่น ต้องเปรียบเทียบใหม่ด้วยตา

#### Test ยืนยันการอ่าน field + timezone (QC3)
`phase8.test.js` มี test ยืนยันว่า scraper อ่าน `createdAt` ของ Kitco และแปลง
timezone ถูกต้อง โดยใช้ fixture ที่บันทึกจาก Kitco __NEXT_DATA__ จริง:
- QC3a: `extractSourcePublishedAt` อ่าน `createdAt` (ไม่ใช่ field อื่น)
- QC3b: `toUtcIso` แปลง ET offset `-0400` → UTC ถูก (09:59-0400 → 13:59Z)
- QC3c: `toBangkokString` แปลง UTC → Bangkok +7 ถูก (13:59Z → 20:59 น.)
- QC3d: end-to-end fixture → sourcePublishedAt + label
- QC3e: `selectTopNews` เรียง Kitco fixtures หลายเขตเวลาถูกตาม UTC

---

## Acceptance Criteria Checklist

| # | ข้อกำหนด | สถานะ | หลักฐาน |
|---|----------|-------|---------|
| 1 | อ่านเวลาเผยแพร่จริงจาก Kitco (หลาย field) | ✅ | `extractSourcePublishedAt` อ่าน createdAt ก่อน |
| 2 | เก็บเป็น sourcePublishedAt (ISO UTC) | ✅ | `toUtcIso` → suffix Z; DB column `source_published_at` |
| 3 | ห้ามใช้ createdAt/publishedAt แทน | ✅ | No Fallback Policy ทุกชั้น |
| 4 | เลือก 3 ข่าวล่าสุดตาม sourcePublishedAt (หลัง dedupe+filter) | ✅ | `selectTopNews`; AC5 test ผ่าน |
| 5 | กรองข่าวซ้ำก่อนเลือก | ✅ | `dedupeList` ใน selectTopNews + pipeline |
| 6 | กรองข่าวไม่ใช่หมวดตลาด (กฎเดิม) | ✅ | `isRelevant` ใน fetchDigest (คงเดิม) |
| 7 | ข่าวไม่มี sourcePublishedAt → needs_review ห้ามเดา | ✅ | AC4 test + pipeline ส่ง needs_review |
| 8 | แสดงผลเรียงตาม sourcePublishedAt | ✅ | ORDER BY source_published_at DESC |
| 9 | แสดง "เผยแพร่เมื่อ ..." (Bangkok time) | ✅ | `formatBangkok` + `toBangkokString` |
| 10 | importedAt แสดงแยก ไม่ใช่ตัวเรียง | ✅ | `importedAt` field แยกใน publicNews |
| 11 | ข่าวเก่า → "ข่าวเพิ่มเติม" | ✅ | V1+V2 news.js โครง latest + more |
| 12 | pagination ใช้ sourcePublishedAt | ✅ | pagination test ผ่าน |
| 13 | เก็บ UTC แสดง Bangkok | ✅ | DB UTC, `toBangkokString` แปลงตอนแสดง |
| 14 | ไม่เกิดปัญหา timezone/รูปแบบวันที่ | ✅ | offset +7 คำนวณเอง ไม่พึ่ง timezone เครื่อง |
| 15 | ตรวจกับ Kitco จริง title/URL/time ตรง | ✅ | ตารางเปรียบเทียบข้างต้น |
| 16 | บันทึก source URL ตรวจย้อนหลังได้ | ✅ | `source_url` column (คงเดิม) |
| 17 | Test: เรียงใหม่→เก่าถูก | ✅ | AC1 |
| 18 | Test: เข้าทีหลัง sourcePublishedAt เก่า ไม่ดันขึ้น | ✅ | AC2 |
| 19 | Test: publish พร้อมกันยังเรียงตาม sourcePublishedAt | ✅ | AC3 |
| 20 | Test: ไม่มี sourcePublishedAt ไม่แซง | ✅ | AC4 |
| 21 | Test: 3 ข่าวล่าสุดจริงหลัง dedupe+filter | ✅ | AC5 + AC5b |
| 22 | Test: V1 และ V2 ลำดับเดียวกัน | ✅ | AC6 |
| 23 | ห้ามสร้างเวลาเอง / ห้าม hardcode 3 ข่าว | ✅ | ไม่มี hardcoded list; ทุกค่าจาก Kitco |
| 24 | `npm run scrape:verify` รายงาน PASS/FAIL รายรายการ | ✅ | verify-news.js แสดงรายละเอียดทุกข่าว |
| 25 | แยกชัด AUTOMATED CHECKS vs MANUAL VERIFICATION | ✅ | CLI แยกส่วน 4 automated checks + เตือนทำ manual |
| 26 | Test ยืนยัน Kitco ใช้ createdAt + แปลง timezone ถูก | ✅ | QC3a-QC3e (fixture จริงจาก Kitco) |
| 27 | Migration id=2 ไม่ทำให้ข้ามการตรวจ column/index | ✅ | column/index check แยกจาก data migration (QC4) |

---

## การแยกระดับ Migration idempotency (QC4)

`applyPhase8Migration` แยกการตรวจ 2 ระดับเพื่อความปลอดภัย:
- **column + index check**: ตรวจและสร้างเสมอทุกครั้ง (PRAGMA table_info + CREATE INDEX IF NOT EXISTS)
  ไม่ขึ้นกับ `schema_migrations id=2` — กันกรณี DB มี id=2 แต่ column/index หายไป
  (เช่น restore บางส่วน หรือมีคนลบ column ด้วยมือ)
- **data migration** (copy `original_published_at` → `source_published_at` หลัง validate):
  ทำครั้งเดียวตาม `schema_migrations id=2` เพื่อกันการทำซ้ำ

ทดสอบยืนยัน QC4: DB ที่มี id=2 แต่ไม่มี column → `applyPhase8Migration`
สร้าง column + index กลับมา, id=2 ไม่ซ้ำ (count = 1)

---

## ไฟล์ที่แก้ไข/สร้าง

**แก้ไข (15):**
- `backend/src/utils/date.js` — เพิ่ม extractSourcePublishedAt, toUtcIso, toBangkokString
- `backend/src/utils/schema.js` — เพิ่ม sourcePublishedAt + REQUIRED_FOR_PUBLISH
- `backend/src/store/migration.sql` — comment อธิบาย Phase 8
- `backend/src/store/db.js` — idempotent ALTER + validate migration + index
- `backend/src/store/newsMapper.js` — mapping sourcePublishedAt
- `backend/src/store/newsRepository.js` — INSERT_COLUMNS + ORDER BY (no fallback)
- `backend/src/scraper/kitco.scraper.js` — extractSourcePublishedAt + selectTopNews
- `backend/src/pipeline/runNewsUpdate.js` — selectTopNews + needsReview
- `backend/src/config/env.js` — NEWS_LATEST_COUNT
- `backend/src/api/publicNews.js` — sourcePublishedAt + importedAt
- `backend/src/cli/test-scrape.js` — แสดง sourcePublishedAt
- `backend/package.json` — scrape:verify script + check list
- `backend/test/phase7.test.js` — makeNews + no-fallback test
- `backend/test/phase6.test.js` — sampleNews sourcePublishedAt
- `backend/test/phase5.test.js` — restart-persistence ใช้ __runMigrationsOn
- Frontend: `helpers.js`, `cards.js`, `news-detail.js`, `news.js`, `home.js` (×2 เวอร์ชัน)

**สร้างใหม่ (3):**
- `backend/src/cli/verify-news.js`
- `backend/test/phase8.test.js`
- `PHASE8-SUMMARY.md` (ไฟล์นี้)

---

## สรุป

Phase 8 พัฒนาเสร็จครบถ้วน ทุก Acceptance Criteria ผ่าน (27/27)
- `npm run check`: ผ่าน (syntax OK)
- `npm test`: **192 passed, 0 failed** (รวม QC3a-QC3e ที่ยืนยันการอ่าน createdAt + timezone)
- `npm run scrape:verify`: **PASS (AUTOMATED)** — 4 automated checks ผ่าน
  (title/sourceUrl/sourcePublishedAt ครบ, เรียงถูก, ไม่ซ้ำ)
- **MANUAL VERIFICATION** (15 ก.ค. 2026): 3 ข่าวแรกจาก scraper ตรงกับ
  หน้า Kitco Digest/Latest News จริง (title, URL, sourcePublishedAt ทุกประการ)
  — ตรวจด้วยตา บันทึกในตารางข้างต้น หากต้องการตรวจซ้ำต้องเทียบใหม่

ระบบตอนนี้เลือกข่าวล่าสุดจริงตามเวลาเผยแพร่ของ Kitco ไม่ใช่ลำดับ scrape
และห้าม fallback ไปเวลาระบบทุกชั้น
