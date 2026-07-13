# TraderToolsTH — เว็บไซต์เทรดเดอร์ครบวงจร

เว็บไซต์ภาษาไทยสำหรับเทรดเดอร์ รวมข่าวตลาด Signal ปฏิทินเศรษฐกิจ รีวิว Broker และบทความความรู้ ไว้ในแบรนด์เดียว สไตล์ **Dark Trading Technology** (ดำ/กราไฟต์ + Neon Cyan + Lime Green)

## โครงสร้างโปรเจกต์

```
Tradertoolsth Website/
├─ index.html              # ส่งต่อไป home.html
├─ home.html / home.js     # หน้าแรก
├─ signal.html / .js       # Signal
├─ news.html / .js         # ข่าว (Forex + ทองคำ)
├─ news-detail.html / .js  # รายละเอียดข่าว (?slug=)
├─ calendar.html / .js     # ปฏิทินข่าวเศรษฐกิจ
├─ brokers.html / .js      # รีวิว Broker
├─ broker-detail.html / .js# รายละเอียด Broker (?slug=)
├─ knowledge.html / .js    # ความรู้
├─ faq.html / .js          # FAQ
├─ contact.html / .js      # ติดต่อเรา
├─ assets/icons/           # favicon + ไอคอน
├─ components/             # icons, helpers, layout (navbar/footer), cards
├─ data/                   # Mock data (signals, news, calendar, brokers, knowledge, faq, site)
├─ services/               # Service Layer สำหรับเชื่อม API จริง
├─ styles/                 # tokens, base, layout, components, navbar, pages
├─ PROJECT-BRIEF.md        # รายละเอียดโปรเจกต์
├─ FOLDER-STRUCTURE.md     # คำอธิบายโครงสร้างโฟลเดอร์
├─ GLM5.2-MASTER-PROMPT.md # คำสั่งหลักสำหรับ AI Agent
├─ WORK-REPORT.md          # รายงานการทำงาน
└─ README.md               # ไฟล์นี้
```

## วิธีรัน

### วิธีที่ 1: เปิดไฟล์โดยตรง

ดับเบิลคลิก `index.html` — ระบบจะส่งต่อไปหน้า `home.html` อัตโนมัติ

> หมายเหตุ: แนะนำให้ใช้เซิร์ฟเวอร์ (วิธีที่ 2) เพื่อให้ JavaScript ทำงานได้เต็มที่

### วิธีที่ 2: รันเซิร์ฟเวอร์ทดสอบ (แนะนำ)

```bash
# ใช้ Python (มีอยู่ในเครื่องส่วนใหญ่)
cd "Tradertoolsth Website"
python -m http.server 8099

# หรือใช้ Node.js
npx serve .
```

แล้วเปิดเบราว์เซอร์ที่ `http://localhost:8099/`

## เทคโนโลยีที่ใช้

- **HTML5** (semantic markup)
- **CSS3** (Custom Properties / Design Tokens, Grid, Flexbox, backdrop-filter)
- **Vanilla JavaScript** (ไม่ใช้ Framework, ไม่ใช้ Build tool)
- **Google Fonts** — IBM Plex Sans Thai + JetBrains Mono
- **ไม่มี dependency ภายนอก** — ทุกอย่าง self-contained

## Design System

| Token | ค่า | การใช้ |
|-------|-----|-------|
| `--bg-base` | `#0a0e14` | พื้นหลังหลัก |
| `--accent` | `#2dd4ff` | Neon Cyan — สีเน้นหลัก |
| `--lime` | `#a3e635` | Lime Green — สีเน้นรอง |
| `--buy` | `#34d399` | สถานะ Buy / กำไร |
| `--sell` | `#f87171` | สถานะ Sell / ขาดทุน |
| `--impact-high` | `#fb7185` | ผลกระทบสูง |

ดูครบใน `styles/tokens.css`

## การเชื่อมระบบจริง

ทุก Service มีตัวแปร `API_ENDPOINT` ที่ตั้งไว้เป็น `null` (ใช้ Mock Data) เมื่อต้องการเชื่อมระบบจริง:

```js
// services/signal.service.js
const API_ENDPOINT = "/api/signals"; // เปลี่ยนจาก null เป็น URL จริง
```

Service จะเรียก `fetch()` โดยอัตโนมัติ และข้าม Mock Data + `delay()` ไป

### ต้นทาง Signal

EA บน MetaTrader 5 อยู่ที่:
```
C:\Users\UsEr\AppData\Roaming\MetaQuotes\Terminal\75108AAC6E09E57B5EE619C88DF23A51\MQL5\Experts\Tradertoolsth_Website
```

การไหลของข้อมูล: `EA/MT5 → Service/API → หน้า Signal บนเว็บ`

## รองรับ

- ✅ Responsive (มือถือ 390px / แท็บเล็ต / คอมพิวเตอร์)
- ✅ Accessibility ขั้นพื้นฐาน (skip link, ARIA, keyboard, focus-visible, prefers-reduced-motion)
- ✅ SEO พื้นฐาน (meta description, semantic HTML, lang="th")
- ✅ Loading / Empty / Error state สำหรับข้อมูล dynamic
- ✅ ภาษาไทยทั้งเว็บ

## ขอบเขตระยะแรก (ตาม PROJECT-BRIEF.md)

- ✅ ทำหน้าเว็บและระบบนำทางให้ครบ
- ✅ ใช้ข้อมูลจำลองในส่วนที่ยังไม่มี API
- ✅ เตรียมจุดเชื่อม Signal, ข่าว และปฏิทินไว้
- ✅ รองรับมือถือ แท็บเล็ต และคอมพิวเตอร์
- ❌ ยังไม่ทำ Login, Payment หรือ Forum เต็มรูปแบบ

## คำเตือนความเสี่ยง

การเทรด Forex และสินทรัพย์ที่มีหลักประกัน (leveraged products) มีความเสี่ยงสูง อาจทำให้สูญเสียเงินทุนทั้งหมด Signal และข้อมูลบนเว็บไซต์เป็นเพียงแนวทาง ไม่ใช่คำแนะนำให้ซื้อหรือขาย
