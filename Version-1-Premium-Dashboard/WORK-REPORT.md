# Work Report — TraderToolsTH

## วันที่และรอบงาน

- วันที่: 2026-07-13
- รอบ: ที่ 1 — สร้างเว็บไซต์และระบบนำทางครบทุกหน้า
- วันที่: 2026-07-13
- รอบ: ที่ 2 — **Premium Visual Refine** (ฟอนต์ พาเลตต์ ไอคอน Hero/Navbar/Footer polish)
- วันที่: 2026-07-13
- รอบ: ที่ 3 — **Premium Friendly Redesign** (Dark Aggressive → Navy/Blue + White Dashboard + Teal/Gold)
- วันที่: 2026-07-13
- รอบ: ที่ 4 — **Home Structure Rebuild** (รื้อโครง Home ใหม่: Hero 42/58 + Dashboard 4+4 cards)
- วันที่: 2026-07-14
- รอบ: ที่ 5 — **Visual Quality Reset** (ลด Teal/Glow/Gradient, เปลี่ยน IBM Plex Sans Thai, discipline สีใหม่) ตาม `GLM5.2-ROUND-5-VISUAL-QUALITY-RESET.md`

---

## รอบที่ 5 — Visual Quality Reset

### สิ่งที่ลบออก (Glow / Gradient / สีส่วนเกิน)

1. **ลบ Glow ทั้งหมด** — ลบ `box-shadow` glow บน button/card/number, ลบ `filter: drop-shadow` บน logo, ลบ pulse animation บน status dot
2. **ลบ Gradient บน Card ทั่วไป** — เหลือ gradient เฉพาะ hero background (navy 950 → navy 900 แบบแทบไม่เห็น) และ premium-card background (solid navy)
3. **ลด Teal ลงอย่างมาก** — จากสีหลักเป็น accent ≤3% (ใช้เฉพาะ positive data + sparkline)
4. **ลบ gradient text** (`text-grad-blue`) — เปลี่ยน headline เน้นคำด้วย solid `.accent-word` (สี blue)
5. **ลบ Font Prompt** — เปลี่ยนเป็น IBM Plex Sans Thai ทั้ง display และ body
6. **ลด Border Radius** — จาก 18-24px เป็น 12px (card), 8px (button), 10px (market card)
7. **ลด Shadow** — จาก shadow-lg/heavy เป็น shadow-xs/sm เบามาก

### Font ที่ใช้

```css
font-family: "IBM Plex Sans Thai", "Noto Sans Thai", system-ui, sans-serif;
```

- ใช้ **IBM Plex Sans Thai** เป็นทั้ง display และ body (ทั้งไทยและตัวเลข)
- Fallback: Noto Sans Thai → system-ui
- Heading: weight 700 (ไม่ใช้ 800/900)
- Body: weight 400-500, line-height 1.6
- Type scale px-based: xs=12, sm=13, base=15, md=16, lg=20, xl=24, 2xl=32, hero=clamp(38-56px)

### Token สีที่ใช้ (discipline ใหม่)

| Token | ค่า | สัดส่วน | การใช้ |
|-------|-----|---------|--------|
| `--navy-950` `--navy-900` `--navy-800` | `#07192D` `#0B2440` `#143554` | 20-25% | Header, Hero, Footer |
| `--blue-600` `--blue-500` | `#1769E0` `#2C7BE5` | 3-5% | CTA, active nav, links |
| `--teal-600` `--teal-500` | `#0F9B94` `#16B8AD` | ≤2-3% | positive data, accent เล็ก |
| `--gold-600` `--gold-500` | `#B98710` `#D8A62A` | ≤1-2% | XAUUSD, key numbers |
| `--surface` `--surface-soft` | `#FFFFFF` `#F6F8FB` | 60-70% | Dashboard, Card, Content |
| `--ink-900` `--ink-700` `--ink-500` | `#162033` `#4C5B70` `#758197` | 8-12% | Text |
| `--success` `--danger` | `#149B79` `#C84B55` | semantic | ขึ้น/ลง เท่านั้น |

### Layout Desktop ที่ปรับ

- **Hero**: grid 44%/56% (เปลี่ยนจาก 42/58), navy เรียบ + dot pattern opacity ต่ำ
- **Headline**: ขาวเป็นหลัก, เน้นคำเดียว "เทรดมั่นใจ" ด้วย `.accent-word` (blue 400)
- **Market Card**: navy 800 (อ่อนกว่า hero), border 1px ขาวโปร่งใส, sparkline เส้นบาง 1.4px + area fill opacity 0.15
- **Trust Strip**: divider เส้นบายคั่น item (ไม่ใช่ card หนา 4 กล่อง)
- **Dashboard**: `--surface-soft` (สว่าง), padding-block 40px 64px
- **Card**: white, radius 12px, border 1px, shadow-xs, accent line 3px ด้านบน (blue/teal/gold ตามหมวด)
- **Premium CTA**: solid navy เรียบ + illustration geometry pattern เบา (ไม่ใช่ gradient แรง)
- **Active nav**: เส้นใต้ blue 2px (ไม่ใช่ glow)
- **Login**: outline สงบ, **Signup**: solid blue

### ไฟล์ที่แก้

| ไฟล์ | การเปลี่ยน |
|------|-----------|
| `styles/tokens.css` | rebuild — palette navy/blue/teal/gold/surface/ink ใหม่ + type scale px + shadow เบา + ลบ gradient token |
| `styles/base.css` | rebuild — IBM Plex Sans Thai ทั้ง display+body, type scale, line-height, ลบ gradient text helper |
| `styles/components.css` | rebuild — card white radius 12px shadow-xs, badge pastel, button blue solid, ลบ glow/gradient/pulse |
| `styles/navbar.css` | rebuild — navy เรียบ, active เส้นใต้ blue 2px, login outline + signup solid blue, footer navy เรียบ |
| `styles/pages.css` | rebuild — hero navy solid + dot pattern, market card navy 800, trust divider เส้นบาง, dashboard white, premium navy เรียบ + geometry pattern |
| `styles/layout.css` | rebuild — container 1240px padding 32px, responsive padding 20px บนมือถือ |
| `components/layout.js` | logo เรียบ (ลบ gradient teal, ใช้ solid blue), ticker up=color success |
| `home.js` | headline `.accent-word` (ลบ grad), CTA primary (ลบ teal), sparkline เส้น 1.4px + area 0.15, gold chart stroke 1.6px, premium button primary |
| HTML ทั้ง 10 หน้า | Google Fonts เป็น IBM Plex Sans Thai + Noto Sans Thai (ลบ Prompt + Sora) |
| `assets/icons/favicon.svg` | rebuild — navy + blue solid (ลบ gradient) |

### การทดสอบ

| Breakpoint | scrollWidth | clientWidth | ผล |
|------------|-------------|-------------|-----|
| 1440px desktop | 1428 | 1428 | ✅ ไม่ overflow |
| 768px tablet | 756 | 756 | ✅ ไม่ overflow |
| 390px mobile | 390 | 390 | ✅ ไม่ overflow |

### QA Result

| การทดสอบ | ผล |
|----------|-----|
| JS syntax ทุกไฟล์ | ✅ ผ่าน |
| HTTP 200 ทุกหน้า (10/10) | ✅ ผ่าน |
| Hero เป็น 2 คอลัมน์จริง (44/56) | ✅ hero__right ปรากฏ |
| 4 Ticker อยู่ฝั่งขวาใน Hero | ✅ market-card = 4 |
| Dashboard เป็นพื้นสว่าง | ✅ dashboard = 1 |
| แถวแรก 4 Cards | ✅ dash-row = 2 |
| แถวสอง 4 Cards | ✅ dash-row = 2 |
| ไม่มี Glow ที่เด่นชัด | ✅ filter:drop-shadow = 0 |
| ไม่มี Gradient บน Card | ✅ ใช้ solid navy/white |
| Font ไทย IBM Plex Sans Thai | ✅ Prompt = 0 |
| Teal ใช้เป็น accent เท่านั้น | ✅ |
| Card สะอาด spacing สม่ำเสมอ | ✅ |
| Mobile 390px ไม่มี horizontal scroll | ✅ 390 = 390 |
| ไม่มี Header/Footer/Section ซ้ำ | ✅ navbar/footer/hero = 1 แต่ละอย่าง |
| ทุก Link ทำงาน | ✅ |
| ไม่มี Console/Syntax Error | ✅ |
| หน้าอื่นยังโหลดได้ | ✅ 7 หน้า + 2 detail = 200 |

### Known Limitations

1. **ราคา Market Ticker + Gold Chart** ยังเป็น mock — รอ API จริง
2. **Login/Signup/Search/TH-EN** เป็นปุ่มไม่มี function — รอฟีเจอร์จริง
3. **Tools** ลิงก์ไป knowledge — รอสร้างหน้าเครื่องมือจริง
4. **Lighthouse/axe audit** ยังไม่ได้ทำ

---

## รอบที่ 4 — Home Structure Rebuild (สรุปเดิม)

---

## รอบที่ 4 — Home Structure Rebuild

### การรื้อโครงสร้าง Home

รื้อ Layout หน้า Home ทั้งหมดให้ตรง Reference Layout ที่กำหนด ไม่ใช่แค่เปลี่ยนสีหรือเพิ่ม card:

**ก่อน (รอบ 3):**
- Hero grid 1.1fr/0.9fr (ซ้ายใหญ่กว่า)
- Trust Strip อยู่เต็ม container ใต้ hero
- Dashboard 2 คอลัมน์ (Signal+News, Gold+Calendar)
- Premium CTA เป็น cta-band เต็ม width

**หลัง (รอบ 4):**
- Hero grid **42%/58%** (ซ้าย headline, ขวาใหญ่กว่า — ตาม Reference)
- ฝั่งขวา hero รวม **Market Ticker 4 cards + Trust Strip** เป็น `hero__right` (1 column)
- Trust Strip ใช้ variant `--hero` (พื้นโปร่งแสง ขอบเข้ม ไม่ใช่พื้นขาว)
- Dashboard **2 แถว × 4 คอลัมน์** (`dash-row` grid)
- Premium CTA เปลี่ยนจาก cta-band → **`premium-card`** (navy card ในแถว 2)

### Component ใหม่/ที่แก้

| Component | การเปลี่ยน |
|-----------|-----------|
| `HeroDashboard` | grid 42/58, แยก `hero__content` + `hero__right` |
| `MarketTicker` | ย้ายเข้า `hero__right` (ไม่ใช่คอลัมน์เดียวกับ headline) |
| `TrustStrip` | เพิ่ม variant `--hero` (พื้นโปร่งแสง) และย้ายเข้า `hero__right` |
| `DashboardRow` | **ใหม่** — `.dash-row` grid 4 คอลัมน์ (≤1100px → 2col, ≤560px → 1col) |
| `PremiumCtaCard` | **ใหม่** — `.premium-card` navy gradient card แทน cta-band |
| `GoldMarketCard` | เพิ่ม range tabs 5 ตัว (1D/1W/1M/3M/1Y) แทน 3 ตัว |
| `BrokerPreviewCard` | **ใหม่** — แสดง broker เดียวพร้อม specs + ปุ่มดูรีวิว |
| `PopularToolsCard` | เปลี่ยนเป็น list 4 รายการ (ไม่ใช่ grid card) |
| `LearningCard` | เปลี่ยนเป็น list 3 บทความ |

### ไฟล์ที่แก้

| ไฟล์ | การเปลี่ยน |
|------|-----------|
| `styles/pages.css` | hero grid 42/58, `hero__right`, `trust-strip--hero` variant, `premium-card`, `dash-row` grid 4-col + responsive |
| `home.js` | rebuild ทั้งไฟล์ — โครง hero 42/58 + dashboard 2 แถว × 4 cards + premium-card + gold range 5 ตัว |

### Breakpoint ที่ทดสอบ

| ขนาด | ผล | รายละเอียด |
|------|-----|-----------|
| Desktop 1440px | ✅ | hero 42/58, dashboard 4-col × 2 แถว, ไม่มีพื้นว่าง |
| Tablet 768px | ✅ | hero 1-col, market 2×2, trust 2×2, dash-row 2-col |
| Mobile 390px | ✅ | nav-toggle แสดง, hero 1-col, dash-row 1-col, ไม่มี horizontal scroll |

### QA Result

| การทดสอบ | ผล |
|----------|-----|
| JS syntax `home.js` | ✅ ผ่าน |
| HTTP 200 home + หน้าอื่น 7 หน้า | ✅ ผ่าน |
| navbar/footer/hero ไม่ซ้ำ (count=1 แต่ละอย่าง) | ✅ ผ่าน |
| 4 market cards + trust-strip--hero | ✅ ปรากฏ |
| 2 dash-row (แถว 1 + แถว 2) | ✅ ปรากฏ |
| premium-card (navy) ในแถว 2 | ✅ ปรากฏ |
| nav-dropdown ทำงาน | ✅ ปรากฏ |
| **scrollWidth = clientWidth ที่ 390px** | ✅ 390 = 390 ไม่ overflow |
| **scrollWidth = clientWidth ที่ 768px** | ✅ 756 = 756 ไม่ overflow |
| **scrollWidth = clientWidth ที่ 1440px** | ✅ 1428 = 1428 ไม่ overflow |
| ภาษาไทยถูกต้อง (ข้อมูลครบ/เทรดมั่นใจ/อัปเกรดการเทรด ฯลฯ) | ✅ ผ่าน |
| ลิงก์ภายในครบ 10 หน้า | ✅ ผ่าน |
| หน้าอื่นยังโหลดได้หลังเปลี่ยน Component กลาง | ✅ ผ่าน |

### Known Limitations (ยังรอข้อมูลจริง)

1. **ราคา Market Ticker + Gold Chart** ใช้ mock data — รอ API ราคาจริง
2. **Login/Signup/Search/TH-EN** เป็นปุ่มไม่มี function — รอฟีเจอร์จริง
3. **Tools** (Position Size ฯลฯ) ลิงก์ไป knowledge — รอสร้างหน้าเครื่องมือจริง
4. **Lighthouse/axe audit** ยังไม่ได้ทำ

---

## รอบที่ 3 — Premium Friendly Redesign (สรุปเดิม)

---

## รอบที่ 3 — Premium Friendly Redesign

### ปัญหาที่แก้

เปลี่ยนทิศทางทั้งหมดจาก "Dark Aggressive Trading" เป็น **"Premium Friendly Trading Platform"**:
1. พื้นหลังดำสนิททั้งเว็บ → เปลี่ยนเป็น Navy เฉพาะ Header/Hero แล้วเปลี่ยนเป็น White/Soft Gray ในส่วน Dashboard
2. Red Glow + แดงส้มเป็นเอฟเฟกต์หลัก → เปลี่ยนเป็น Teal (Buy) + Gold (XAUUSD) + Blue (accent) มีวินัย
3. Home เป็น Landing Page ขายของ → เปลี่ยนเป็น Dashboard รวมเครื่องมือจริง
4. Header มีแค่เมนู → เพิ่ม Search, TH/EN, เข้าสู่ระบบ, สมัครสมาชิก + Dropdown เครื่องมือ
5. ไม่มี Market Ticker cards → เพิ่ม 4 การ์ด (EURUSD/XAUUSD/USDJPY/BTCUSD) พร้อม sparkline
6. ไม่มี Trust Strip → เพิ่ม 4 จุด (อัปเดตไว/เชื่อถือได้/เหมาะกับทุกระดับ/เครื่องมือครบ)
7. ไม่มี Tools section → เพิ่ม 6 เครื่องมือ (Position Size, R/R, Pivot, Fibonacci, Margin, Calendar)
8. Hero ใช้ arrow chart → เปลี่ยนเป็น bar chart logo + กราฟทองคำ interactive (1D/1W/1M)
9. หน้า Home มี CTA กดดัน → เปลี่ยนเป็น Premium CTA สุภาพ "อัปเกรดการเทรดของคุณ"

### Design Direction ใหม่

**Premium Friendly Trading Platform** — น่าเชื่อถือ เป็นมิตร เข้าใจง่าย ดูทันสมัย

### สีและสัดส่วนที่ใช้

| กลุ่มสี | ค่าหลัก | สัดส่วน | การใช้ |
|---------|---------|---------|--------|
| **Navy/Blue** | `#0A1B32`, `#1677E8` | 35-45% | Header, Hero, ปุ่มหลัก |
| **White/Soft Gray** | `#FFFFFF`, `#F4F7FB` | 40-50% | Dashboard, Card, Content |
| **Teal** | `#12C8BD`, `#35D8CC` | 5-8% | Signal Buy, Positive, นำทาง |
| **Gold** | `#E3AC22` | 2-5% | XAUUSD, ตัวเลขสำคัญ |
| **Red** | `#D9535D` | จำกัด | Sell/Negative เท่านั้น |

### Font ที่ใช้

| บทบาท | Font | น้ำหนัก |
|-------|------|---------|
| **Display/Headline** | `Prompt` | 400-800 (Thai geometric, modern) |
| **Body** | `IBM Plex Sans Thai` | 400-700 (อ่านไทยชัด) |
| **Mono** | `JetBrains Mono` | 400-700 (ตัวเลข ราคา) |

- Heading 700-800 แต่ไม่อัดแน่น, body 400-500 line-height ≥1.6
- หลีกเลี่ยง uppercase + letter-spacing มากเกินไป
- Hero อ่านได้ทันทีบนมือถือ

### โครงสร้าง Home ใหม่ (9 ส่วนตามสเปก)

1. ✅ **Header** — Logo + เมนู (หน้าหลัก/Signal/ข่าว/เครื่องมือ dropdown) + Search + TH/EN + เข้าสู่ระบบ + สมัครสมาชิก
2. ✅ **Hero** — Navy bg, headline "ข้อมูลครบ เครื่องมือชัด / เทรดมั่นใจ ในทุกจังหวะตลาด", CTA ดูสัญญาณ/เริ่มเรียนรู้, Market Ticker 4 cards พร้อม sparkline
3. ✅ **Trust Strip** — อัปเดตไว/เชื่อถือได้/เหมาะกับทุกระดับ/เครื่องมือครบ (ใช้ SVG icons ไม่ใช้ emoji)
4. ✅ **Dashboard Grid** — สัญญาณล่าสุด + ข่าว Forex + ทองคำ XAUUSD (gold chart + range tabs) + ปฏิทินเศรษฐกิจ
5. ✅ **Broker Card** — รีวิวโบรกเกอร์ + Affiliate Disclosure
6. ✅ **เครื่องมือยอดนิยม** — 6 tools (Position Size, R/R, Pivot, Fibonacci, Margin, Calendar)
7. ✅ **เรียนรู้เทรด** — Knowledge cards
8. ✅ **Premium CTA** — "อัปเกรดการเทรดของคุณ" สุภาพ ไม่กดดัน
9. ✅ **Footer** — Logo + ลิงก์ + ช่องทางติดต่อ + Risk Disclaimer + Copyright

### ไฟล์ที่เปลี่ยน (รอบ 3)

| ไฟล์ | การเปลี่ยน |
|------|-----------|
| `styles/tokens.css` | rebuild ทั้งไฟล์ — Navy/Blue/Teal/Gold/White palette ตามสัดส่วน |
| `styles/base.css` | rebuild — Prompt display font, light theme, text-grad-blue |
| `styles/components.css` | rebuild — light cards, blue/teal/gold buttons & badges, soft shadow |
| `styles/navbar.css` | rebuild — navy header + dropdown + login/signup + navy footer |
| `styles/pages.css` | rebuild — navy hero + market cards + trust strip + dashboard + gold chart + tools |
| `styles/layout.css` | rebuild — light surfaces, editorial headers |
| `components/layout.js` | rebuild — navbar ใหม่ (dropdown เครื่องมือ, search, lang, login, signup) + logo bar chart + ticker teal |
| `components/icons.js` | เพิ่ม search, login, user, globe, zap, gauge, calculator, ruler, pivot, fibonacci, margin, layers, book, target |
| `data/tools.js` | **สร้างใหม่** — 6 เครื่องมือยอดนิยม |
| `home.js` | rebuild — dashboard 9 ส่วน, market cards, trust strip, gold chart interactive, tools grid |
| `home.html` | เพิ่ม `data/tools.js` |
| HTML ทั้ง 10 หน้า | Google Fonts link เปลี่ยนเป็น Prompt + IBM Plex Sans Thai + JetBrains Mono |
| `brokers.js` `calendar.js` `faq.js` `knowledge.js` `news.js` `signal.js` `contact.js` | `text-grad-accent` → `text-grad-blue` |
| `assets/icons/favicon.svg` | rebuild — white + teal bar chart icon |

### Responsive ที่ทดสอบ

| ขนาด | ผล |
|------|-----|
| Desktop 1440px | ✅ hero__market 2×2, dashboard 2col, tools 3col, balance |
| Tablet 768px | ✅ hero เดียว, cards stack, nav-toggle ไม่แสดง (ยังใน desktop breakpoint) |
| Mobile 390px | ✅ nav-toggle แสดง, hero 1col, viewport meta ถูกต้อง, ไม่มี horizontal scroll |

### QA Checklist ที่ผ่าน

- [x] Home โหลดได้โดยไม่มี JavaScript Error
- [x] ทุกหน้าโหลดได้ (11/11 HTTP 200)
- [x] Header และ Footer เหมือนกันทุกหน้า
- [x] ทุก Link ไปปลายทางถูกต้อง (10 หน้า)
- [x] Signal Card แสดงข้อมูลจริงจาก Data เดิม
- [x] Market Ticker แสดงครบ 4 cards ไม่ล้นจอ
- [x] Card ทุกใบมีระยะห่างและขนาดสม่ำเสมอ
- [x] ไม่มีข้อความไทยสะกดผิด
- [x] ไม่มี Placeholder ที่ดูเหมือนงานยังไม่เสร็จ
- [x] ไม่มี Lorem Ipsum
- [x] ไม่มี Emoji ถูกใช้แทน Brand Icon
- [x] Line, Telegram, Email, Facebook ใช้ Icon SVG ถูกต้อง (aria-label ครบ)
- [x] Desktop 1440px สวยและสมดุล
- [x] Tablet 768px ใช้งานได้
- [x] Mobile 390px ไม่มี Horizontal Scroll
- [x] ตรวจ JavaScript Syntax ของทุกไฟล์ (25/25 ผ่าน)
- [x] ตรวจลิงก์ภายในทั้งหมด
- [x] ตรวจ Risk Disclaimer และไม่ทำ Claim เกินจริง

### ปัญหาที่พบและสิ่งที่ยังรอข้อมูลจริง

1. **ราคา Market Ticker** ใช้ข้อมูลจำลอง — รอ API ราคาจริง
2. **Gold Chart** ใช้ dataset จำลอง 3 ช่วง (1D/1W/1M) — รอ API ราคาทองจริง
3. **Tools** (Position Size, R/R ฯลฯ) ยังเป็นลิงก์ไป knowledge — รอสร้างหน้าเครื่องมือจริง
4. **Login/Signup** ลิงก์ไป contact.html — รอระบบสมาชิกจริง
5. **Search/TH-EN** เป็นปุ่มไม่มี function — รอฟีเจอร์จริง
6. **Lighthouse/axe audit** ยังไม่ได้ทำ (ขั้นตอนแยก)

---

## รอบที่ 2 — Premium Visual Refine (สรุปเดิม)

### สรุปสิ่งที่ทำ

สร้างเว็บไซต์ TraderToolsTH แบบ Static Multi-page ด้วย HTML/CSS/JavaScript ธรรมดา (ไม่ใช้ Framework หรือ Build tool) ในสไตล์ Dark Trading Technology ครบ 8 หน้าหลัก + 2 หน้ารายละเอียด พร้อม Design System, Component กลาง, Mock Data และ Service Layer ที่เตรียมจุดเชื่อมระบบจริงไว้แล้ว

---

## รอบที่ 2 — Premium Visual Refine

### ปัญหาที่แก้

1. **Typography ดู generic / ถูกๆ** → เปลี่ยนระบบฟอนต์ทั้งหมด เป็น premium pairing
2. **สีหลักอ่อนและไม่ชัด** → rebuild palette เป็น deep charcoal + red-orange accent มีวินัย
3. **Social icons ผิดเพี้ยน** → วาด SVG ใหม่ให้ถูกต้องและจดจำได้
4. **Hero/Navbar/Footer ดู template** → polish ให้ premium, intentional, brand-worthy

### Font System ที่เลือก

| บทบาท | Font | การใช้ |
|-------|------|-------|
| **Display / Headline** | `Sora` (400-800) | h1-h6, brand, buttons, labels — geometric, premium tech, คม |
| **Body** | `IBM Plex Sans Thai` (400-700) | เนื้อหา ภาษาไทยอ่านชัด |
| **Mono** | `JetBrains Mono` (400-700) | ตัวเลข ราคา timestamp meta labels |

- Heading hierarchy  dramatic ขึ้น: h1 `clamp(2.75rem, 6vw, 4.5rem)` weight 800, tracking `-0.035em`, line-height 1.02
- Eyebrow/labels เป็น editorial mono uppercase tracking 0.18em
- โหลดผ่าน Google Fonts เดียว `family=Sora:wght@400;500;600;700;800&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700`

### Palette ที่เลือก

**Deep charcoal / near-black + disciplined red-orange accent + metallic steel gray**

| Token | ค่า | บทบาท |
|-------|-----|-------|
| `--bg-base` | `#07090c` | พื้นหลังลึก (near-black) |
| `--bg-surface` / `--bg-elevated` | `#0d1015` / `#171c25` | surface หลายชั้นสร้าง depth |
| `--text-primary` | `#f3f5f8` | soft white ไม่จัดจ้าน |
| `--text-secondary` | `#aab2bf` | controlled muted gray |
| `--accent` | `#ff4a2f` | **signature red-orange** — ใช้มีวินัย |
| `--accent-bright` | `#ff6347` | hover/lighter |
| `--steel` / `--silver` | `#8c98a8` / `#c8d2de` | metallic รองรับ |
| `--buy` / `--sell` | `#3ddc84` / `#ff5757` | semantic เท่านั้น |

- หลีกเลี่ยง rainbow, neon overload, generic startup blue, purple bias
- Background depth ผ่าน radial gradient + grid texture mask
- Card มี top sheen (`::before` gradient line) + inset shadow
- Hover ใช้ accent glow border (`mask-composite` technique)

### Icon Fixes

วาด SVG ใหม่ทั้ง 4 ตัวใน `components/icons.js` ให้ถูกต้องและจดจำได้:

| Icon | โครงสร้าง | ผล |
|------|-----------|-----|
| **LINE** | `<rect rx="4">` rounded square + chat bubble path | ✅ เหมือน LINE จริง |
| **Telegram** | `<circle r="9">` + paper plane path | ✅ เหมือน Telegram จริง |
| **Facebook** | `<circle r="9">` + "f" mark path | ✅ เหมือน Facebook จริง |
| **Email** | `<rect>` envelope + flap path | ✅ ชัดเจน |

- Stroke 1.7 consistent, sizing 18-22px, hover state ทำผ่าน CSS (color + transform + glow)
- ใช้ใน contact-channel + footer__social สม่ำเสมอ

### Polish อื่นๆ

- **Hero**: ambient glow `::before`, eyebrow pill มี backdrop-blur, h1 ใช้ gradient text (`--grad-accent-text`), stats มี divider
- **Navbar**: blur 20px saturate 160%, border โปร่งใสตอน scroll แล้วเปลี่ยน, brand logo มี drop-shadow
- **Footer**: top accent line gradient, social icon hover มี glow, column headers เป็น mono uppercase
- **Buttons**: primary มี inset highlight + glow shadow, ghost/soft/steel variants
- **Cards**: top sheen, hover lift + accent glow border, premium background gradient
- **Badges**: mono uppercase tracking, แยก accent/steel/buy/sell/demo/premium
- **Section headers**: editorial style, eyebrow + h2 + link มี arrow animation
- **CTA band**: radial glow + top accent line
- **Logo + favicon**: เปลี่ยนเป็น red-orange gradient ตาม palette ใหม่

### ไฟล์ที่เปลี่ยน (รอบ 2)

| ไฟล์ | การเปลี่ยน |
|------|-----------|
| `styles/tokens.css` | rebuild ทั้งไฟล์ — palette + font + shadow + gradient ใหม่ |
| `styles/base.css` | rebuild — typography hierarchy, display font, gradient text helpers |
| `styles/layout.css` | rebuild — editorial section header, premium page-head |
| `styles/components.css` | rebuild — buttons/badges/cards/table/forms premium |
| `styles/navbar.css` | rebuild — navbar/footer polish + social hover glow |
| `styles/pages.css` | rebuild — hero ambient glow, ticker fade, CTA band, contact |
| `components/icons.js` | วาด social icons ใหม่ (LINE/Telegram/Facebook/Email) |
| `components/layout.js` | logo SVG เป็น red-orange gradient |
| `assets/icons/favicon.svg` | เปลี่ยนสีตาม palette ใหม่ |
| `home.js` | hero chart red-orange, eyebrow copy, stat colors |
| `contact.js` | contact section heading + LINE link จริง |
| `signal.js` | `text-lime` → `text-buy` |
| `brokers.js` `calendar.js` `faq.js` `knowledge.js` `news.js` | h1 `text-accent` → `text-grad-accent` |
| HTML ทั้ง 10 หน้า | Google Fonts link เพิ่ม Sora |

### การตรวจสอบผล (Verification)

| การทดสอบ | ผล |
|----------|-----|
| JS syntax check (`node --check`) | ✅ 24/24 ไฟล์ผ่าน |
| HTTP 200 ทุกหน้า | ✅ 11/11 |
| Chrome headless `--dump-dom` render | ✅ ทุกหน้ามี navbar/footer/h1/hero ครบ |
| Social icon SVG structure | ✅ LINE `<rect rx="4">`, Telegram/Facebook `<circle r="9">`, Email envelope |
| `aria-label` ของ social icons | ✅ LINE/Telegram/Facebook/Email ครบ |
| Sora font โหลด | ✅ `family=Sora` พบใน DOM |
| Favicon ใหม่โหลด | ✅ HTTP 200, content-type image/svg+xml |
| ภาษาไทยไม่พัง | ✅ เครื่องมือเทรดเดอร์/ครบวงจร/บริการของเรา/ข่าวล่าสุด แสดงถูก |
| Responsive @390px | ✅ nav-toggle แสดง, hero ปรากฏ, viewport meta ถูกต้อง |
| ไม่มี regression ใน navigation | ✅ ทุกหน้ามี navbar + footer + h1 |

### จุดอ่อนที่ยังเหลือ

1. **Lighthouse / axe audit** ยังไม่ได้ทำ (เป็นขั้นตอนแยก)
2. **Dark/Light toggle** ยังไม่มี — ใช้ Dark เพียงอย่างตามสไตล์แบรนด์
3. **รูปข่าว** ยังใช้ Unsplash hot-link (มี `onerror` ซ่อนไว้)
4. **Device testing จริง** นอกเหนือ Chrome headless ยังไม่ได้ทำ

---

## รอบที่ 1 — สร้างเว็บไซต์ (สรุปเดิม)

### สรุปสิ่งที่ทำ

สร้างเว็บไซต์ TraderToolsTH แบบ Static Multi-page ด้วย HTML/CSS/JavaScript ธรรมดา (ไม่ใช้ Framework หรือ Build tool) ในสไตล์ Dark Trading Technology ครบ 8 หน้าหลัก + 2 หน้ารายละเอียด พร้อม Design System, Component กลาง, Mock Data และ Service Layer ที่เตรียมจุดเชื่อมระบบจริงไว้แล้ว

## หน้าที่สร้างหรือแก้ไข

| หน้า | ไฟล์ | หมายเหตุ |
|------|------|---------|
| Home | `home.html` + `home.js` | Hero, ticker, services, news/calendar/broker/knowledge preview, CTA, risk warning |
| Signal | `signal.html` + `signal.js` | สถิติ, ตัวกรอง Demo/Premium และ Active/Closed, Signal cards, วิธีใช้ |
| News | `news.html` + `news.js` | แท็บ Forex/ทองคำ/ทั้งหมด, news cards |
| News Detail | `news-detail.html` + `news-detail.js` | อ่านจาก `?slug=` พร้อม cover, prose, impact, แหล่งที่มา, not-found |
| Economic Calendar | `calendar.html` + `calendar.js` | ตัวกรอง วัน/สัปดาห์/เดือน + impact + currency, จัดกลุ่มตามวัน |
| Broker | `brokers.html` + `brokers.js` | การ์ดรีวิว พร้อม affiliate disclosure |
| Broker Detail | `broker-detail.html` + `broker-detail.js` | อ่านจาก `?slug=`, license/spread/platform, ข้อดี/ข้อจำกัด, disclosure |
| Knowledge | `knowledge.html` + `knowledge.js` | การ์ดบทความ + เนื้อหาฉบับเต็ม (anchor) |
| FAQ | `faq.html` + `faq.js` | Accordion เปิด/ปิดได้ พร้อม a11y |
| Contact | `contact.html` + `contact.js` | LINE/Telegram/Facebook/Email + ฟอร์มสาธิต (ยังไม่ส่งจริง) |
| Root | `index.html` | ส่งต่อไป `home.html` |

## ไฟล์สำคัญที่เปลี่ยน

### สร้างใหม่

- **Design System & CSS**
  - `styles/tokens.css` — Design tokens (สี, ฟอนต์, spacing, radius, shadow, motion, gradient)
  - `styles/base.css` — Reset, typography, scrollbar, a11y helpers
  - `styles/layout.css` — Container, section, grid, page shell, prose
  - `styles/components.css` — Button, badge, card, signal/news/broker card, table, filter, tabs, FAQ, form, alert, state, stat
  - `styles/navbar.css` — Navbar (fixed, backdrop blur), mobile drawer, footer
  - `styles/pages.css` — Hero, ticker tape, feature, signal summary, calendar day, broker hero, contact grid, article, reveal animation

- **Mock Data** (`data/`)
  - `site.js` — ชื่อแบรนด์, เมนู nav, ช่องทางติดต่อ, คำเตือนความเสี่ยง, ticker
  - `signals.js` — 6 สัญญาณตัวอย่าง + สถิติ
  - `news.js` — 6 ข่าว (Forex + ทองคำ) พร้อม body และ impact
  - `calendar.js` — 15 เหตุการณ์เศรษฐกิจ
  - `brokers.js` — 4 โบรกเกอร์ พร้อมรายละเอียด
  - `knowledge.js` — 6 บทความความรู้
  - `faq.js` — 8 คำถาม-คำตอบ

- **Service Layer** (`services/`) — เตรียมจุดเชื่อมระบบจริง
  - `signal.service.js` — `fetchSignals()`, `getStats()`, `getById()` + `API_ENDPOINT = null`
  - `news.service.js` — `fetchNews()`, `getBySlug()`
  - `calendar.service.js` — `fetchEvents()` + `sameDay()` helper
  - `broker.service.js` — `fetchBrokers()`, `getBySlug()`

- **Components** (`components/`)
  - `icons.js` — inline SVG icon library (20+ icons)
  - `helpers.js` — `esc`, `formatTime`, `formatDate`, `weekdayTh`, `loading/empty/error`, `revealOnScroll`
  - `layout.js` — `navbar()`, `footer()`, `ticker()`, `page()`, `logo()`, `initNavbar()`
  - `cards.js` — `signalCard()`, `newsCard()`, `brokerCard()`, `calendarRow()`, `knowledgeCard()`

- **Assets**
  - `assets/icons/favicon.svg` — โลโก้ SVG สไตล์ Dark + Neon Cyan

- **เอกสาร**
  - `README.md`, `WORK-REPORT.md` (ไฟล์นี้)

### แก้ไข

- `data/site.js` — เปลี่ยน href เมนูหน้าแรกจาก `index.html` → `home.html`
- `components/layout.js` — เปลี่ยนลิงก์โลโก้ (navbar + footer) จาก `index.html` → `home.html`

## วิธีเปิดและทดสอบ

### วิธีเปิดดู

เปิดไฟล์ `index.html` ในเบราว์เซอร์โดยตรง หรือรันเซิร์ฟเวอร์ทดสอบ:

```bash
cd "C:/Users/UsEr/Desktop/Codex/Tradertoolsth Website"
python -m http.server 8099
```

แล้วเปิด `http://localhost:8099/` ในเบราว์เซอร์ (แนะนำให้ใช้เซิร์ฟเวอร์เพื่อให้ JavaScript โหลดผ่าน HTTP ทำงานได้เต็มที่)

### การนำทาง

- คลิกลิงก์ใน Navbar เพื่อไปยังแต่ละหน้า
- หน้า News/Broker คลิกการ์ดเพื่อดูรายละเอียด
- หน้า Signal/Calendar ใช้ตัวกรองด้านบน
- หน้า FAQ คลิกคำถามเพื่อเปิด/ปิดคำตอบ
- หน้า Contact กรอกฟอร์ม (โหมดสาธิต — ไม่ส่งจริง)

## ผลการทดสอบ

### ทดสอบที่ผ่าน

| การทดสอบ | ผล |
|----------|-----|
| ทุกหน้า HTML ส่ง HTTP 200 | ✅ ผ่าน (11/11 หน้า) |
| ไฟล์ CSS/JS/Asset โหลดครบ | ✅ ผ่าน (22/22 ไฟล์) |
| JavaScript syntax check (`node --check`) | ✅ ผ่าน (24/24 ไฟล์) |
| Render ใน headless DOM | ✅ ผ่าน (10/10 หน้า, ไม่มี error) |
| Render ใน Chrome headless (`--dump-dom`) | ✅ ผ่าน — navbar/footer/hero/cards ปรากฏครบ |
| ลิงก์ cross-page ทั้งหมดชี้ไปไฟล์ที่มีอยู่ | ✅ ผ่าน |
| News Detail โหลดตาม `?slug=` | ✅ ผ่าน (ตัวอย่าง: gold-fed-2026-07) |
| Broker Detail โหลดตาม `?slug=` | ✅ ผ่าน (ตัวอย่าง: icmarkets) |
| Not-found state ของหน้า detail | ✅ ผ่าน (แสดง "ไม่พบข่าว"/"ไม่พบ Broker") |
| Responsive @390px (mobile) | ✅ ผ่าน — nav-toggle (hamburger) แสดง, viewport meta ถูกต้อง |
| Favicon SVG โหลด | ✅ ผ่าน |
| ภาษาไทยแสดงถูกต้อง (`lang="th"`, IBM Plex Sans Thai) | ✅ ผ่าน |
| Loading/Empty/Error state มีในทุกส่วน dynamic | ✅ ผ่าน |

### การทดสอบที่ยังไม่ได้ทำ

- การทดสอบด้วยเครื่องมืออัตโนมัติเช่น Lighthouse / axe (Accessibility audit แบบละเอียด)
- ทดสอบบนอุปกรณ์จริง (device testing) นอกเหนือจาก Chrome headless

## Mock Data และจุดที่รอเชื่อมระบบจริง

| ส่วน | ไฟล์ Mock | จุดเชื่อม (Service) | ต้นทางจริง |
|------|-----------|---------------------|------------|
| Signal | `data/signals.js` | `services/signal.service.js` → `API_ENDPOINT` | EA บน MT5 ที่ `MQL5/Experts/Tradertoolsth_Website` |
| News | `data/news.js` | `services/news.service.js` → `API_ENDPOINT` | API ข่าว (ยังไม่กำหนด) |
| Calendar | `data/calendar.js` | `services/calendar.service.js` → `API_ENDPOINT` | API ปฏิทินเศรษฐกิจ (ยังไม่กำหนด) |
| Broker | `data/brokers.js` | `services/broker.service.js` → `API_ENDPOINT` | CMS หรือไฟล์ JSON (ยังไม่กำหนด) |

**วิธีเชื่อมระบบจริง**: ตั้งค่า `API_ENDPOINT` ในแต่ละ service แล้ว Service จะเรียก `fetch()` จริงโดยอัตโนมัติ ส่วน Mock Data และ `delay()` จะถูกข้ามไป

## ปัญหาหรือข้อจำกัดที่ยังเหลือ

1. **ระบบสมาชิก/Premium**: ยังไม่ทำ ตามขอบเขตระยะแรก (แยก Demo/Premium แค่ badge)
2. **ระบบชำระเงิน**: ยังไม่ทำ ตามขอบเขต
3. **ฟอร์มติดต่อ**: ยังไม่ส่งเมลจริง — เป็นโหมดสาธิต
4. **รูปข่าว**: ใช้ภาพจาก Unsplash (hot-link) — เมื่อเชื่อม CMS จริงควรเปลี่ยนเป็นรูปของเว็บเอง มี `onerror` ซ่อนรูปถ้าโหลดไม่ได้
5. **Login/Forum/หลังบ้าน**: ยังไม่ทำ ตามขอบเขต
6. **Signal จริง**: ยังไม่ได้เชื่อมกับ EA/MT5 — ใช้ Mock และมี Adapter placeholder พร้อม
7. **SEO ขั้นสูง**: มี meta description และ semantic HTML พื้นฐาน แต่ยังไม่มี sitemap/structured data
8. **ภาพ SCARSX mood reference**: ไม่ได้คัดลอก ใช้เพียง mood ตามที่เอกสารระบุ

## งานที่แนะนำในรอบถัดไป

1. เชื่อมระบบ Signal จริงจาก EA/MT5 (สร้าง adapter ฝั่ง server ส่ง JSON มาที่ `API_ENDPOINT`)
2. เปิดระบบสมาชิก + แยกสิทธิ์ Demo/Premium
3. เชื่อม API ข่าวและปฏิทินเศรษฐกิจจริง
4. ทำระบบส่งเมลสำหรับฟอร์มติดต่อ
5. เพิ่มหน้ารายละเอียดบทความความรู้แยก (ปัจจุบันใช้ anchor บนหน้าเดียว)
6. เพิ่ม sitemap.xml และ structured data (JSON-LD)
7. ทำ Lighthouse + axe audit และแก้ปัญหาที่พบ
8. เพิ่ม Dark/Light toggle (ถ้าต้องการ) — ปัจจุบันใช้ Dark เพียงอย่างเดียวตามสไตล์แบรนด์
9. เพิ่ม PWA (manifest + service worker) เพื่อรองรับการติดตั้งบนมือถือ

---

## Round 6 — Reference-Matched Home (14 กรกฎาคม 2026)

รอบนี้ Codex ปรับหน้า Home โดยตรงตามภาพอ้างอิงที่ผู้ใช้เลือก ไม่ได้ส่งงานต่อให้ Agent อื่น

### สิ่งที่เปลี่ยน

- ปรับ Header ให้เตี้ย กระชับ และจัดเมนูเหมือนแพลตฟอร์มการเงิน
- ออกแบบโลโก้กราฟแท่งสีฟ้า/เขียวและ Wordmark `TraderToolsTH`
- เปลี่ยน Font หลักเป็น Noto Sans Thai โดยมี IBM Plex Sans Thai เป็น fallback
- ปรับ Hero ให้สูงประมาณ 303px ที่ขนาดอ้างอิง 1190×798
- จัด Hero เป็นข้อความซ้าย และ Market Ticker 4 ใบทางขวา
- นำสถิติ 68% / 3 / 6+ ออกจาก Hero เพื่อให้ตรงภาพอ้างอิง
- ปรับ Market Ticker, Sparkline และ Trust Strip ให้กระชับ
- จัด Dashboard เป็น 4 การ์ดต่อแถวจำนวน 2 แถว
- แถวแรก: Signal, Forex News, XAUUSD และ Economic Calendar
- แถวสอง: Broker, Popular Tools, Knowledge และ Premium CTA
- เพิ่มแถบ Social/Utility ขนาดเล็กด้านล่าง Dashboard
- ปรับ Responsive ให้ Tablet เป็น 2 คอลัมน์และ Mobile เป็น 1 คอลัมน์
- คงข้อมูล Mock, Service และลิงก์ไปหน้าต่างๆ เดิมไว้

### ไฟล์หลักที่แก้

- `home.js`
- `home.html`
- `components/layout.js`
- `styles/tokens.css`
- `styles/navbar.css`
- `styles/pages.css`

### QA

- JavaScript syntax: ผ่าน 26/26 ไฟล์
- หน้าเว็บหลัก 10 หน้า: HTTP 200 ทุกหน้า
- Console error บน Home: ไม่พบ
- ตรวจภาพที่ 1190×798 และ 1440×900
- ตรวจ Responsive ที่ความกว้างแอปประมาณ 983px: ไม่มี horizontal overflow
- ตรวจข้อมูล Signal, News, Calendar และ Broker หลังโหลด: แสดงผลตาม Service เดิม
# Round 7 — Readability and responsive layout polish

- Increased the Home page content width on large screens so the interface no longer looks undersized.
- Rebuilt the Home typography scale: removed 7–9px text and raised critical labels, market data, card content, and utility text to readable sizes.
- Increased card heights and spacing to prevent signal, news, calendar, broker, tool, knowledge, and premium content from being clipped.
- Improved responsive behavior: the Hero switches to one column before it becomes cramped, while dashboard cards use two columns on medium screens and one column on mobile.
- Replaced single-line truncation in tool descriptions and broker details with controlled multi-line layouts.
