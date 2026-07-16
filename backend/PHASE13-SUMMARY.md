# Phase 13 — Market Ticker API + Calendar API Contract

> สถานะ: backend-only (frontend `market.html` จะทำใน phase ถัดไป)
> ห้าม commit/push — ยังไม่ได้รับการอนุมัติจาก Codex

## 1. ไฟล์ที่สร้าง/แก้

| ไฟล์ | ประเภท | หน้าที่ |
|------|--------|---------|
| `src/market/sources.js` | **ใหม่** | Adapters ต่อแหล่งข้อมูลจริง (gold-api, er-api, coingecko) |
| `src/market/marketService.js` | **ใหม่** | Orchestrate: fetch + cache + timeout + stale + history |
| `src/api/marketApi.js` | **ใหม่** | Handler `/api/market-ticker` (public, read-only) |
| `src/config/env.js` | แก้ | เพิ่ม `config.market` section |
| `src/server.js` | แก้ | wire marketService + marketScheduler (start/stop) |
| `src/api/server.js` | แก้ | mount marketHandler + import |
| `package.json` | แก้ | เพิ่มไฟล์ใหม่ใน `npm run check` |
| `.env.example` | แก้ | เพิ่ม config `MARKET_*` |
| `test/phase13.test.js` | **ใหม่** | Tests: success/timeout/stale/empty/invalid/rate-limit |
| `PHASE13-SUMMARY.md` | **ใหม่** | เอกสารนี้ |

> หมายเหตุ: Calendar API (`/api/calendar`, `/api/calendar/upcoming`) และ service
> มีอยู่แล้วจากงาน concurrent (Phase 12) และทำงานถูกต้องหลังแก้ bug
> `ERR_HTTP_HEADERS_SENT` (calendarApi.js return pattern) — ไม่ต้องสร้างใหม่

---

## 2. แหล่งข้อมูลจริงที่ใช้ (เฉพาะ free public, ไม่ต้องการ API key)

| Asset class | Symbols | แหล่งข้อมูล | URL | รูปแบบ |
|-------------|---------|------------|-----|--------|
| Metals | XAUUSD, XAGUSD | gold-api.com | `https://api.gold-api.com/price/{XAU\|XAG}` | JSON `{price, updatedAt}` |
| Forex | EURUSD, GBPUSD, USDJPY | open.er-api.com | `https://open.er-api.com/v6/latest/USD` | JSON `{rates:{EUR,GBP,JPY,...}}` |
| Crypto | BTCUSD | CoinGecko | `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true` | JSON `{bitcoin:{usd,usd_24h_change}}` |
| Index | DXY | **ไม่มีแหล่งฟรีที่น่าเชื่อถือ** | — | `unavailable:true` (ไม่ใช่ข้อมูลปลอม) |

**กฎความปลอดภัย:**
- ทุก request ดึงจาก backend เท่านั้น (browser ไม่มีทางเรียก third-party ตรงๆ)
- ไม่มี secret/API key ใดๆ ใน source code, log, หรือ response
- cache ≥ 60s ป้องกัน hammer source (requirement กำหนด ≥ 30s)
- timeout 8s ต่อ symbol; ล้มเหลว → ใช้ cache ล่าสุด + `stale:true`

---

## 3. API Contract

### `GET /api/market-ticker`

ราคา watchlist ทั้งหมด (เรียกผ่าน backend เท่านั้น)

**Query params:**
- `symbols` (optional): comma-separated, เช่น `?symbols=XAUUSD,EURUSD` — whitelist validated
- `assetClass` (optional): `forex|metals|crypto|index|all` (default `all`)

**Response 200 (envelope):**
```json
{
  "items": [
    {
      "symbol": "XAUUSD",
      "assetClass": "metals",
      "price": 2415.30,
      "change": 2.45,
      "percent": 0.1014,
      "direction": "up",
      "source": "gold-api.com",
      "sourceUrl": "https://gold-api.com",
      "unavailable": false,
      "unavailableReason": null,
      "updatedAt": "2026-07-16T05:00:00.000Z",
      "stale": false,
      "history": [2400.1, 2405.2, 2410.0, 2415.3]
    },
    {
      "symbol": "DXY",
      "assetClass": "index",
      "price": null,
      "change": null,
      "percent": null,
      "direction": "flat",
      "source": null,
      "sourceUrl": null,
      "unavailable": true,
      "unavailableReason": "no_data_source",
      "updatedAt": null,
      "stale": false,
      "history": []
    }
  ],
  "updatedAt": "2026-07-16T05:00:00.000Z",
  "stale": false,
  "source": "aggregated",
  "count": 7
}
```

**Response 400 (invalid query):**
```json
{ "error": "invalid_asset_class", "allowed": ["all","forex","metals","crypto","index"] }
```

### `GET /api/market-ticker/status`
สถานะ service (debug/health) — ไม่ส่ง secret ใดๆ

### `GET /api/calendar` (มีอยู่แล้ว — อ้างอิง)

**Query:** `from`, `to` (YYYY-MM-DD UTC), `currency`, `importance`/`impact`, `limit` (upcoming)
**Response:** `{ items:[{id,currency,impact,scheduledAtUtc,scheduledAtBangkok,actual,forecast,previous,...}], updatedAt, stale, source }`

เวลาทุกตัวใน API เป็น **UTC** (`scheduledAtUtc`) + มี `scheduledAtBangkok` สำเร็จรูปให้ frontend

---

## 4. วิธีเรียกจาก frontend (phase ถัดไป — ยังห้ามทำใน phase นี้)

```javascript
// 1) ราคาทั้งหมด (refresh ทุก 30s ใน frontend)
const ticker = await fetch('/api/market-ticker').then(r => r.json());
// → ticker.items, ticker.stale, ticker.updatedAt

// 2) filter ตาม asset class
const metals = await fetch('/api/market-ticker?assetClass=metals').then(r=>r.json());

// 3) เฉพาะ symbols ที่ต้องการ
const focus = await fetch('/api/market-ticker?symbols=XAUUSD,EURUSD').then(r=>r.json());

// 4) ข่าวที่เกี่ยวข้อง (ใช้ /api/news ที่มีอยู่)
const news = await fetch('/api/news?category=gold&limit=3').then(r=>r.json());

// 5) ปฏิทินเศรษฐกิจที่เกี่ยวข้อง (USD สำหรับส่วนใหญ่)
const cal = await fetch('/api/calendar/upcoming?limit=5&currency=USD&impact=high').then(r=>r.json());

// แปลงเวลา UTC → Bangkok ใน frontend:
const bangkokTime = new Date(item.scheduledAtUtc).toLocaleString('th-TH', {
  timeZone: 'Asia/Bangkok'
});
```

---

## 5. ข้อจำกัดที่ยังเหลือ (สำคัญ — ต้องรายงาน Codex)

1. **DXY ไม่มีแหล่งข้อมูลฟรีที่น่าเชื่อถือ** (ไม่ต้องการ key):
   - ตัวเลือกที่ตรวจแล้ว: gold-api.com (`Symbol not found`), Yahoo Finance (ต้องล็อกอิน/มีความเสี่ยง), Investing (มี anti-bot)
   - DXY ตอนนี้คืน `unavailable:true` + `unavailableReason:"no_data_source"` — frontend แสดง "ไม่พร้อมใช้งาน" ไม่ใช่ราคาปลอม
   - ทางเลือก: สร้าง adapter ที่ใช้ free key (เช่น Alpha Vantage free tier) — แต่ต้องการ key management และขัด scope "ไม่แก้ .env"
   - **รอคำสั่ง Codex** ว่าจะให้ (A) เพิ่ม free-key source, (B) คำนวณ DXY proxy จาก forex rates, หรือ (C) ปล่อย unavailable

2. **history[] เป็น in-memory ring buffer (24 จุด)**:
   - หายเมื่อ server restart (ยอมรับได้สำหรับ sparkline)
   - ไม่ persist ลง DB (เพื่อไม่กระทบ schema และไม่เปลือง storage)
   - ครั้งแรกที่เปิดจะว่างจนกว่าจะ sync 2+ รอบ → frontend แสดง empty state อย่างสุภาพ

3. **Initial sync lazy** (ไม่บล็อก server boot): request แรกจะ trigger sync → อาจช้า ~1-2s ครั้งแรก ครั้งต่อไปจาก cache

4. **source third-party อาจมี rate limit / downtime**:
   - มี cache fallback + stale flag แล้ว
   - แต่ถ้า source ปิดให้บริการถาวร → ต้องเพิ่ม adapter สำรอง (เก็บไว้ phase ถัดไป)

5. **Calendar bug `ERR_HTTP_HEADERS_SENT` ที่พบระหว่างสำรวจ**: ถูกแก้ไขแล้วโดยงาน concurrent (calendarApi.js return pattern) — ไม่ใช่การแก้ของผม แต่ยืนยันว่าทำงานถูกต้องแล้ว

---

## 6. ผลการทดสอบ

- `npm run check`: ✅ syntax OK (รวมไฟล์ใหม่)
- `npm test`: (ดูรายละเอียดในรายงานสุดท้าย)
- `git diff --check`: (ดูในรายงานสุดท้าย)
- smoke test จริงกับ source: (ดูในรายงานสุดท้าย)
