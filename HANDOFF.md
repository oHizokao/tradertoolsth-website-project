# TraderToolsTH — News Automation Handoff

อัปเดตล่าสุด: 15 กรกฎาคม 2026

## สถานะปัจจุบัน

ระบบข่าวทำงานครบเส้นทางแล้ว:

1. ดึงรายการข่าวล่าสุดและเนื้อหาบทความจาก Kitco
2. ตัดข่าวเก่า ข่าวซ้ำ และแหล่งข่าวภายนอกที่ไม่ผ่านนโยบาย
3. ใช้ OpenAI เรียบเรียงเป็นภาษาไทยและตรวจข้อเท็จจริง/ตัวเลข/คำต้องห้าม
4. ค้นหารูปจาก Pexels พร้อมเก็บเครดิตและใบอนุญาต
5. เก็บข่าวใน SQLite และป้องกันการบันทึกข่าวซ้ำ
6. เผยแพร่อัตโนมัติเฉพาะข่าวที่ผ่านทุก Quality Gate
7. ให้บริการข่าวผ่าน API และเชื่อมกับหน้าเว็บ V1 และ V2 แล้ว
8. ตั้งเวลาอัปเดตอัตโนมัติได้ และป้องกันงานสองรอบทำงานชนกัน

ระบบไม่เผยแพร่ข่าวเมื่อ AI เป็นโหมดจำลอง, คะแนนต่ำ, ตัวเลขไม่ตรง, พบคำชี้นำลงทุน, รูปต้องตรวจเพิ่ม, ขาดเครดิต หรือขาดลิงก์ต้นทาง

## ผลการทดสอบล่าสุด

- Unit/Integration: `157 passed, 0 failed`
- Storage E2E: `30 passed, 0 failed`
- Syntax check: ผ่าน
- Dependency audit: `0 vulnerabilities`
- Live Kitco digest: ผ่าน — อ่าน 240 รายการ, คัดข่าวสดได้ และไม่เหลือ URL ซ้ำ
- Live Kitco article: ผ่าน — ดึงเนื้อหาบทความจริงได้ 3,603 ตัวอักษร
- Browser E2E V1: หน้ารวม/หน้าอ่านข่าว/เครดิตรูป/ลิงก์ Kitco ผ่าน ไม่มี console error
- Browser E2E V2: หน้ารวม/หน้าอ่านข่าว/เครดิตรูป/ลิงก์ Kitco ผ่าน ไม่มี console error

ยังไม่ได้ยิง OpenAI/Pexels แบบเสียเงินจริง เพราะ API key ที่ส่งในแชตถือว่าเปิดเผยแล้วและไม่ควรนำไปใช้ต่อ

## เริ่มใช้งานที่เครื่องใหม่

ต้องติดตั้ง Node.js 20 ขึ้นไป จากนั้นเปิด Terminal ที่โฟลเดอร์ `backend`

```powershell
npm install
Copy-Item .env.example .env
```

เปิด `backend/.env` แล้วกรอกค่าต่อไปนี้ด้วย key ใหม่เท่านั้น:

```env
OPENAI_API_KEY=ใส่_key_ใหม่ที่นี่
OPENAI_TEXT_MODEL=gpt-4o-mini
PEXELS_API_KEY=ใส่_pexels_key_ที่นี่

DATABASE_URL=file:./data/news.db
SERVER_HOST=127.0.0.1
PORT=3000
SITE_VERSION=2

SCHEDULER_ENABLED=false
RUN_ON_START=false
AUTO_PUBLISH=false
NEWS_INTERVAL_MINUTES=60
NEWS_MAX_PER_RUN=5
```

ทดสอบก่อนเปิดระบบจริง:

```powershell
npm run check
npm test
npm run news:update
npm start
```

เปิดเว็บ:

- หน้าเลือกเวอร์ชัน: `http://127.0.0.1:3000/`
- V1: `http://127.0.0.1:3000/v1/`
- V2: `http://127.0.0.1:3000/v2/`
- ตรวจสุขภาพระบบ: `http://127.0.0.1:3000/api/health`

## เปิดระบบอัตโนมัติ

หลังจากทดลอง `npm run news:update` สำเร็จด้วย key ใหม่แล้ว ให้เปลี่ยนใน `.env`:

```env
SCHEDULER_ENABLED=true
RUN_ON_START=true
AUTO_PUBLISH=true
```

จากนั้นรัน:

```powershell
npm start
```

ระบบจะทำงานทันทีตอนเปิด และทำซ้ำตาม `NEWS_INTERVAL_MINUTES` ข่าวหนึ่งรอบถูกจำกัดด้วย `NEWS_MAX_PER_RUN` เพื่อคุมค่าใช้จ่าย

## กฎเผยแพร่อัตโนมัติ

ข่าวจะถูกเผยแพร่เมื่อครบทุกข้อ:

- `validationStatus = validated`
- รูปมีสถานะ `selected`
- รูปไม่ถูกตั้ง `imageReviewRequired`
- มีหัวข้อและเนื้อหาภาษาไทย
- มีลิงก์ข่าวต้นทางและเครดิต
- มี URL รูปและลิงก์ที่มาของรูป
- ไม่ใช่ข่าวซ้ำ

ข่าวที่ไม่ผ่านจะเก็บไว้ในฐานข้อมูล แต่ไม่ถูกส่งออกทาง Public API

## API ที่พร้อมใช้

- `GET /api/health` — สถานะ server/scheduler
- `GET /api/news?category=all&limit=50` — ข่าวที่เผยแพร่แล้วเท่านั้น
- `GET /api/news/:id` — รายละเอียดข่าวที่เผยแพร่แล้ว
- `GET /api/admin/news` — รายการสำหรับตรวจสถานะ (ต้องมี Admin token)
- `POST /api/admin/run` — สั่งอัปเดตทันที (ต้องมี Admin token)

หากต้องใช้ Admin API ให้ตั้ง `ADMIN_TOKEN` เป็นค่าสุ่มยาวใน `.env` และส่ง Header `Authorization: Bearer <token>`

## ไฟล์สำคัญ

- `backend/src/server.js` — จุดเริ่ม server
- `backend/src/pipeline/runNewsUpdate.js` — ควบคุมการอัปเดตข่าวทั้งรอบ
- `backend/src/pipeline/newsPipeline.js` — AI/Image/Storage pipeline รายข่าว
- `backend/src/scheduler/newsScheduler.js` — ตั้งเวลาและ run lock
- `backend/src/api/server.js` — Public/Admin API และ static website server
- `backend/src/api/publicNews.js` — แปลงข้อมูลฐานข้อมูลเป็น schema ของ V1/V2
- `backend/src/store/newsRepository.js` — SQLite repository และ publish guard
- `backend/.env.example` — ตัวอย่าง config ที่ไม่มี secret
- `backend/test/phase6.test.js` — integration test ของระบบรอบสุดท้าย

## ความปลอดภัยและสิ่งที่ยังต้องทำ

1. Revoke OpenAI key ที่เคยส่งในแชต แล้วสร้าง key ใหม่
2. ห้าม commit `backend/.env`, database, log หรือ API key — `.gitignore` ป้องกันไว้แล้ว
3. สร้าง Pexels API key เพื่อให้ระบบเลือกรูปจริงและผ่าน auto-publish gate
4. รอบแรกควรใช้ `AUTO_PUBLISH=false` เพื่อตรวจผลจาก API จริงก่อน
5. ก่อน deploy สาธารณะ ให้ใช้ HTTPS, reverse proxy/process manager และสำรอง `backend/data/news.db`
6. หากรันหลาย server/container ต้องย้าย scheduler lock และ Pexels rate limit ไป storage กลาง

## หมายเหตุด้านเนื้อหา

หน้าเว็บแสดงเครดิตและลิงก์กลับไปยัง Kitco รวมถึงเครดิตภาพ Pexels โดยอัตโนมัติ ระบบเรียบเรียงใหม่เพื่อสรุปข้อเท็จจริง ไม่ได้มีไว้เพื่อหลบการอ้างอิงแหล่งข้อมูล และทุกข่าวมีคำเตือนว่าไม่ใช่คำแนะนำซื้อขาย
