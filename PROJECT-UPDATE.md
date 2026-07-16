# TraderToolsTH — Project Update

อัปเดตล่าสุด: 16 กรกฎาคม 2026

เอกสารนี้สรุปสถานะโปรเจกต์หลังการปรับระบบข่าวและ Version 2 จนถึงปัจจุบัน
ตั้งแต่วันที่ 16 กรกฎาคม 2026 เป็นต้นไป โปรเจกต์ใช้งานเฉพาะ **Version 2** เท่านั้น
Version 1 (Premium Dashboard) ถูกนำออกจากระบบและสำรองไว้ที่ `backup/version-1-before-removal-20260716/`

## สถานะโดยรวม

- Backend ข่าวทำงานบนเครื่องที่ `http://127.0.0.1:3000`
- หน้า Version 2 ใช้ธีมน้ำเงินเข้ม/ทองครบทุกหน้าย่อย
- หน้าเว็บรองรับข่าวจาก Public API จริง
- ระบบตรวจข่าวมีทั้ง deterministic validation และ AI validation
- API key อยู่ฝั่ง Backend ใน `.env` และไฟล์ถูก Git ignore
- ทดสอบ Backend ผ่านทั้งหมด 158/158 รายการ
- ข่าวที่เผยแพร่สาธารณะอยู่ในระบบ 3 ข่าว
- ข่าวเก่าที่ไม่ผ่านการตรวจ 5 รายการยังเก็บไว้ ไม่ได้ลบ

## ข่าวปัจจุบัน

ข่าวที่เผยแพร่ในระบบตอนนี้มาจาก Kitco และแสดงบน:

- [News](http://127.0.0.1:3000/Version-2-Gold-Trading/news.html)

ข่าว 3 รายการที่นำเข้ารอบทดสอบ:

1. Abrdn ระบุทองคำเป็นสินทรัพย์ที่สำคัญในโครงสร้าง
2. Bank of America ยังมองหุ้นเหมืองทองมีมูลค่าน่าสนใจ
3. ราคาโลหะมีค่าอ่อนตัวท่ามกลางเหตุโจมตีในอ่าว และยอดขายเงินของ Perth Mint ลดลง

หมายเหตุ: รอบทดสอบเดิมเรียงตามเวลาที่ระบบเผยแพร่ (`publishedAt`) เนื่องจากยังไม่ได้เก็บและใช้ `sourcePublishedAt` ของ Kitco เป็นตัวเรียงหลัก จึงยังไม่รับประกันว่าเป็น 3 ข่าวบนสุดของหน้า Kitco แบบตรงตัว

## Backend ที่ทำเสร็จแล้ว

- ดึง digest และเปิดบทความเต็มจาก Kitco
- ตรวจ source policy และกันแหล่งข่าวที่ไม่อนุญาต
- AI rewrite พร้อมตรวจ schema
- ตรวจตัวเลขที่เพิ่มหรือเปลี่ยนจากต้นฉบับ
- ตรวจคำแนะนำลงทุนและคำต้องห้าม
- มี correction retry หนึ่งครั้งเมื่อพบตัวเลขผิด
- แยกสถานะ validation กับ publish status
- รองรับ `draft`, `ready`, `published`, `rejected`, `failed`
- มี image pipeline และ owned SVG placeholder เมื่อไม่มี Pexels key
- ตรวจ duplicate ด้วย source URL และ duplicate hash
- มี audit metadata สำหรับการตรวจทานด้วยคน

## Admin API ที่มีอยู่

Admin API ต้องใช้ `Authorization: Bearer <ADMIN_TOKEN>` และ token ต้องอยู่ใน Backend เท่านั้น

- `GET /api/admin/news` — ดูข่าวทุกสถานะ
- `GET /api/admin/news/:id` — ดูรายละเอียดข่าว
- `POST /api/admin/run` — สั่งดึงข่าวและประมวลผลหนึ่งรอบ
- `POST /api/admin/news/:id/review` — บันทึกผลตรวจทานและแก้ไขข่าว
- `POST /api/admin/news/:id/approve` — อนุมัติข่าวที่ validated แล้ว
- `POST /api/admin/news/:id/reject` — ปฏิเสธข่าว
- `POST /api/admin/news/:id/publish` — เผยแพร่ข่าวที่ผ่าน publish guard

ตัวอย่างสั่งดึงข่าวทดสอบ:

```powershell
$token = "<ADMIN_TOKEN จาก backend/.env>"
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:3000/api/admin/run" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"maxPerRun":3}'
```

ค่าเริ่มต้นปัจจุบัน:

- `AUTO_PUBLISH=false`
- `SCHEDULER_ENABLED=false`
- `RUN_ON_START=false`
- การรัน Admin จะไม่เผยแพร่ข่าวอัตโนมัติ ต้องตรวจและ publish ผ่าน guard ก่อน

## Frontend Version 2

- เชื่อม `subpages-v2.css` ให้หน้าข่าว ปฏิทิน โบรกเกอร์ ติดต่อ FAQ ความรู้ และสัญญาณ
- แก้ปัญหาแถบนำทางล้นบนมือถือ
- รองรับการ์ดข่าว รูปภาพ fallback และลิงก์ไปหน้ารายละเอียด
- ตรวจหน้า Desktop และ Mobile แล้วไม่พบ body horizontal overflow

## Auto Pilot

แนวคิด Auto Pilot ถูกกำหนดสเปกไว้แล้ว แต่ยังไม่ได้เปิดใช้งานจริงในโค้ดปัจจุบัน

ก่อนเปิดใช้จริงต้องมีอย่างน้อย:

- ปุ่มเปิด/ปิดและ Emergency Stop ใน Admin Dashboard
- server-side feature flag ค่าเริ่มต้นเป็นปิด
- publish เฉพาะข่าวที่ผ่าน source, AI, deterministic, image และ duplicate gates ครบทุกข้อ
- audit log ทุกการเผยแพร่
- จำกัดจำนวนข่าวต่อรอบและป้องกันการรันซ้อน
- rollback ข่าวล่าสุด
- หยุดอัตโนมัติเมื่อ scraper หรือ validator ผิดปกติ

## สิ่งที่ควรทำต่อ

1. เพิ่ม `sourcePublishedAt` จาก Kitco และใช้เป็นตัวเรียงข่าวหลัก
2. สร้าง Admin Dashboard แบบเล็กสำหรับ run/review/approve/publish
3. เพิ่ม pagination และส่วน “ข่าวเพิ่มเติม” สำหรับข่าวเก่า
4. เพิ่ม Auto Pilot หลังจากทดสอบ manual workflow จนเสถียร
5. เปลี่ยน OpenAI API key ก่อน deploy เพราะ key เดิมถูกส่งในแชตแล้ว
6. Deploy เว็บขึ้นโฮสต์จริงหรือใช้ tunnel หากต้องการให้เพื่อนเข้าดู

## การตรวจสอบล่าสุด

```text
npm test     158 passed, 0 failed
npm run check syntax OK
Public API  published news = 3
ENV         ignored by Git
```

ไฟล์ฐานข้อมูลก่อนรอบ pilot ถูกสำรองไว้ใน `backend/data/news-before-pilot-20260715-151503.db`

