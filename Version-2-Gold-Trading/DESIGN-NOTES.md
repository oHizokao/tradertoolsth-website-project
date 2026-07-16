# Version 2 Design Notes

## Direction

Premium trading workstation ที่ดูจริงจังแต่ใช้งานง่าย โดยใช้สีทองเฉพาะจุดสำคัญ สีเขียวอมฟ้าสำหรับสถานะบวก และพื้น Navy เพื่อให้ข้อมูลตลาดเด่นชัด

## Main colors

- Deep Navy: `#020E1C`
- Navy: `#031426`
- Panel: `#0A2138`
- Gold: `#E5B33F`
- Teal: `#25BCA8`
- Blue: `#2F8DDD`

## Files added or changed

- `home.js` — โครงสร้างหน้า Home แบบที่สอง
- `styles/home-v2.css` — Theme, layout และ responsive ของ Version 2
- `components/layout.js` — โลโก้และเมนูสำหรับ Theme ใหม่
- `home.html` — โหลด Style และ Script ของ Version 2

หมายเหตุ: Version 1 (Premium Dashboard) ถูกนำออกจากระบบแล้วตั้งแต่วันที่ 16 กรกฎาคม 2026 Version 2 (Gold Trading Desk) จึงเป็นชุดเว็บไซต์หลักเพียงชุดเดียว

## Readability revision

- ขยาย Typography ของ Navbar, Hero, Signal, ข่าว, ปฏิทิน, เครื่องมือ และแถบคุณสมบัติ
- ย้ายเวลาที่เผยแพร่ข่าวให้อยู่บรรทัดเดียวกับหมวดข่าว เพื่อไม่ให้ถูกเนื้อหาเบียด
- ปรับตัวอย่างระดับความสำคัญในปฏิทินเป็น 3, 2 และ 1 จุด
- เพิ่มพื้นที่การ์ดและปรับ Breakpoint ให้ Tablet ใช้สองคอลัมน์เร็วขึ้น
