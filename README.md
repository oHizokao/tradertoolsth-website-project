# TraderToolsTH Website

เว็บไซต์ TraderToolsTH ใช้งานเฉพาะ **Version 2 — Gold Trading Desk** เท่านั้น
(โทนน้ำเงินเข้ม/ทอง พร้อม Signal ข่าว ปฏิทิน และเครื่องมือในหน้าเดียว)

Version 1 (Premium Dashboard) ถูกนำออกจากระบบแล้ว ส่วน backup ถูกเก็บไว้ที่
`backup/version-1-before-removal-20260716/` เพื่อความเรียบร้อย

## URL หลัก

เปิดผ่าน backend server (ค่าเริ่มต้น `http://127.0.0.1:3000/`):

| หน้า | URL |
| --- | --- |
| หน้าหลัก | `/Version-2-Gold-Trading/home.html` |
| ข่าวสาร | `/Version-2-Gold-Trading/news.html` |
| รายละเอียดข่าว | `/Version-2-Gold-Trading/news-detail.html` |
| Admin Dashboard | `/Version-2-Gold-Trading/admin.html` |
| โบรกเกอร์ | `/Version-2-Gold-Trading/brokers.html` |
| ปฏิทินเศรษฐกิจ | `/Version-2-Gold-Trading/calendar.html` |
| บทวิเคราะห์ | `/Version-2-Gold-Trading/knowledge.html` |
| สัญญาณเทรด | `/Version-2-Gold-Trading/signal.html` |

Root URL (`/`) และ `index.html` จะถูกส่งตรงไปยังหน้า Home ของ Version 2 โดยอัตโนมัติ

## โครงสร้างโฟลเดอร์

```
Tradertoolsth_Project/
├── Version-2-Gold-Trading/   ← เว็บไซต์หลัก (Gold Trading Desk)
├── shared-assets/            ← รูปภาพข่าวที่ใช้ร่วม
├── backend/                  ← API ข่าว + Admin/Auto Pilot
├── backup/                   ← backup ของ Version 1 ก่อนนำออก
└── index.html                ← redirect ไปยัง Version 2 home
```

## รันเว็บไซต์

```bash
cd backend
npm install
npm start          # เปิด http://127.0.0.1:3000/
```

ดูรายละเอียดเพิ่มเติมได้ที่ `backend/README` และเอกสาร phase ต่าง ๆ ในโฟลเดอร์ `backend/`
