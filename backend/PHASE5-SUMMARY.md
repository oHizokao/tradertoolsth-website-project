# Phase 5 — SQLite Storage + AI/Image Integration

## สถานะ

เสร็จและผ่านการทดสอบในขอบเขต Phase 5 แล้ว ระบบสามารถรับข่าวหนึ่งรายการ ตรวจข่าวซ้ำ ประมวลผลด้วย AI pipeline เลือกรูปตามเงื่อนไข และบันทึกลง SQLite ได้ โดยยังไม่เผยแพร่ข่าวอัตโนมัติ

## สิ่งที่ทำ

- เพิ่ม SQLite ด้วย `better-sqlite3`
- เพิ่ม migration ที่รันซ้ำได้
- เพิ่ม repository สำหรับ insert, query, filter, status update และ duplicate detection
- แยก `validationStatus` ออกจาก `publishStatus`
- เพิ่ม `validatedAt` และ `publishedAt`
- เชื่อม AI pipeline กับ image pipeline และ storage
- ตรวจข่าวซ้ำก่อนเรียก AI/Pexels เพื่อลดค่าใช้จ่าย
- ตรวจข่าวซ้ำซ้ำอีกครั้งภายใน transaction ก่อน insert
- เรียก image pipeline เฉพาะข่าวที่ผ่านการประมวลผลเป็น `validated` หรือ `needs_review`
- ข่าว external, source policy ไม่ผ่าน, เนื้อหาไม่ครบ, `rejected` และ `failed` จะไม่เรียก Pexels
- บล็อกการตั้ง `publishStatus=published` หากข่าวยังไม่ `validated`
- เพิ่ม CLI E2E แบบ mock ที่ไม่เรียก OpenAI, Pexels หรือ Kitco จริง

## ไฟล์หลัก

- `src/store/db.js` — เปิด SQLite, migration และ transaction helper
- `src/store/migration.sql` — ตารางข่าวและ indexes
- `src/store/newsMapper.js` — แปลง News object กับ DB row
- `src/store/newsRepository.js` — บันทึก, ค้นหา, filter, dedup และ status update
- `src/pipeline/newsPipeline.js` — dedup → AI → image gate → save
- `src/cli/test-store.js` — E2E mock
- `test/phase5.test.js` — regression tests ของ Phase 5

## Database

ค่าเริ่มต้น:

```env
DATABASE_URL=file:./data/news.db
```

ตำแหน่งจริงคือ `backend/data/news.db` ไม่ใช่ `backend/data/data/news.db`

Indexes:

- `source_url`
- `duplicate_hash`
- `validation_status`
- `publish_status`
- `original_published_at`

ไม่มีการทำ `original_content` เป็น UNIQUE การตรวจซ้ำใช้ `sourceUrl` และ `duplicateHash`

## Status rules

- `validationStatus=validated` หมายถึงเนื้อหาผ่านการตรวจ
- `publishStatus=processing` หมายถึงยังไม่เผยแพร่
- Phase 5 ไม่เปลี่ยนข่าวเป็น `published` อัตโนมัติ
- Repository ปฏิเสธการตั้ง `published` ให้ข่าวที่ยังไม่ `validated`
- `validatedAt` มีค่าเมื่อข่าวเป็น `validated`
- `publishedAt` ยังเป็น `null` จนกว่าจะมี explicit publish action ใน phase ถัดไป

## Image rules

- `validated` และ `needs_review` ที่ผ่าน AI processing สามารถเข้าสู่ image pipeline
- `rejected` และ `failed` ไม่เรียก image pipeline
- external/source-policy-blocked และ missing-content ไม่เรียก image pipeline แม้สถานะเป็น `needs_review`
- ข่าวซ้ำไม่เรียก AI หรือ Pexels
- เก็บเฉพาะ URL และ metadata ไม่ดาวน์โหลดไฟล์รูป

## คำสั่งใช้งานและตรวจสอบ

```bash
npm install
npm test
npm run check
npm run store:test
npm audit --omit=dev
```

## ผลทดสอบล่าสุด

- `npm test`: 151 tests, 35 suites, ผ่าน 151, ไม่ผ่าน 0
- `npm run check`: syntax OK
- `npm run store:test`: 30 checks ผ่านทั้งหมด
- `npm audit --omit=dev`: 0 vulnerabilities

การทดสอบครอบคลุม migration, path ฐานข้อมูล, insert/query, JSON mapping, duplicate detection, transaction rollback, restart persistence, status separation, publish guard, image gate, external source, missing content และ early duplicate gate

## สิ่งที่ยังไม่ได้ทำ

- Scheduler/cron
- API server
- เชื่อม Frontend V1/V2
- การเผยแพร่ข่าวจริง
- การทดสอบ OpenAI/Pexels ด้วย API key จริง

Phase 5 พร้อมสำหรับ QC และพร้อมเป็นฐานสำหรับ phase ถัดไป แต่ระบบเว็บไซต์ข่าวทั้งชุดจะยังไม่ทำงานอัตโนมัติจนกว่าจะเพิ่ม Scheduler, API และ Frontend integration
