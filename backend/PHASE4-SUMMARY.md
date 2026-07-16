# Phase 4 — สรุปงานระบบ Pexels Image Search

> ระบบข่าวอัตโนมัติ TraderToolsTH — **Phase 4**
> หัวหน้าโปรเจกต์: Codex (QC) · ผู้พัฒนา: Antigravity Agent
> วันที่อัปเดตล่าสุด: 2026-07-14

---

## 🎯 สถานะปัจจุบัน

| Phase | สถานะ | หมายเหตุ |
|-------|-------|---------|
| Phase 1 — ตรวจโปรเจกต์ | ✅ ผ่าน QC | |
| Phase 2 — Scraper | ✅ ผ่าน QC | dedupe + age filter + รวม label |
| Phase 3 — OpenAI | ✅ ผ่าน QC (51/51 tests) | rewriter + validator + source gating |
| **Phase 4 — Pexels** | 🔜 **ส่ง QC** | Pexels client + keyword + ranking + pipeline |
| Phase 5 — Storage + Scheduler | ⏳ รออนุมัติ | ห้ามเริ่ม |
| Phase 6 — Frontend | ⏳ รออนุมัติ | ห้ามเริ่ม |
| Phase 7 — ทดสอบ | ⏳ รออนุมัติ | |

---

## 1. สิ่งที่ทำทั้งหมด

สร้างระบบค้นหารูปภาพจาก Pexels **เท่านั้น** — ไม่แตะ Database/Scheduler/API server/Frontend ตามที่กำหนด

### ไฟล์ที่สร้างใหม่

| ไฟล์ | บรรทัด | หน้าที่ |
|------|------:|--------|
| `src/image/keywords.js` | 108 | สร้าง image search keywords จาก news |
| `src/image/ranking.js` | 110 | ตรวจความเหมาะสมทางเตคนิค + deduplication + score threshold |
| `src/image/pexels.client.js` | 158 | Pexels API client (native fetch) + mapPhotoToMetadata |
| `src/image/rateLimiter.js` | 115 | **[QC fix]** Global sliding-window rate limiter |
| `src/image/imagePipeline.js` | 108 | Orchestrate keyword → search → rank → metadata |
| `test/phase4.test.js` | 726 | **115 tests** ครอบคลุมทุกกรณี |
| `backend/PHASE4-SUMMARY.md` | ไฟล์นี้ | สรุปงาน Phase 4 |

### ไฟล์ที่แก้ไข

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `src/config/env.js` | เพิ่ม `config.pexels.timeoutMs`, `retries`, `delayMs` |
| `backend/.env.example` | เพิ่ม `PEXELS_HTTP_TIMEOUT_MS`, `PEXELS_HTTP_RETRIES`, `PEXELS_KEYWORD_DELAY_MS` |
| `backend/package.json` | อัปเดต `check` script ให้ครอบคลุมไฟล์ image module |

---

## 2. รายชื่อไฟล์ที่สร้างหรือแก้ไข

```
backend/
├── .env.example                    ← แก้ไข (เพิ่ม Pexels tuning vars)
├── package.json                    ← แก้ไข (check script + description)
├── PHASE4-SUMMARY.md               ← สร้างใหม่ (ไฟล์นี้)
└── src/
    ├── config/env.js               ← แก้ไข (pexels timeout/retry/delay)
    └── image/                      ← ✨ ใหม่ทั้งหมด
        ├── keywords.js
        ├── ranking.js
        ├── pexels.client.js
        ├── imagePipeline.js
        └── rateLimiter.js              ← ✨ [QC fix] Global rate limiter
test/
└── phase4.test.js                  ← สร้างใหม่ (115 tests, 26 suites)
```

---

## 3. โครงสร้างการทำงานของระบบ

```
news (มี imageSearchKeywords จาก AI rewriter)
  ↓
[keywords.js] buildImageKeywords(news)
  - AI keywords ก่อน (imageSearchKeywords)
  - static topic map (gold → "gold bars", fed → "Federal Reserve")
  - generic fallback ("financial market trading")
  - normalize + dedupe + จำกัด 5 keywords
  ↓
[imagePipeline.js] loop ทุก keyword (delay 500ms ระหว่าง keyword):
  [pexels.client.js] searchPhotos(keyword)
    - native fetch → Pexels /v1/search?orientation=landscape
    - timeout + retry + backoff
    - ไม่มี key → คืน [] (mock/fallback)
  รวม photos จากทุก keyword
  ↓
[ranking.js] deduplicatePhotos (by photo.id)
  ↓
[ranking.js] rankPhotos → scorePhoto ทุกรูป:
  - portrait (h > w) → score=0 (ตัดออก)
  - ความละเอียดต่ำ < 800px → score=0 (ตัดออก)
  - landscape bonus: +50
  - resolution bonus: min(floor(w/100), 20)
  - aspect ratio bonus: +15 (16:9), +8 (ใกล้), +3 (พอได้)
  เรียงตาม score สูงสุดก่อน
  ↓
[ranking.js] selectBestPhoto → { photo, score, reviewRequired }
  - reviewRequired = score < SCORE_THRESHOLD (60)
  ↓
[pexels.client.js] mapPhotoToMetadata(photo, keywords)
  → { imageUrl, imageSource, imageAuthor, imageAuthorUrl,
      imageLicense, imageSourceUrl, imageSearchKeywords }
  ↓
คืน { status, reviewRequired, ...metadata }
```

---

## 4. วิธีตั้งค่าและใช้งาน

### ตั้งค่า .env

```bash
# คัดลอก .env.example → .env แล้วใส่ค่า
cp backend/.env.example backend/.env
```

แก้ไข `backend/.env`:
```env
PEXELS_API_KEY=your_pexels_api_key_here
```

### ใช้งานจาก code

```js
import { findImageForNews } from './src/image/imagePipeline.js';

const result = await findImageForNews(news);
// result = {
//   status: 'selected' | 'fallback' | 'failed',
//   reviewRequired: true | false,
//   imageUrl: '...',
//   imageSource: 'Pexels',
//   imageAuthor: '...',
//   imageAuthorUrl: '...',
//   imageLicense: 'Pexels License',
//   imageSourceUrl: '...',
//   imageSearchKeywords: ['gold bars', ...]
// }
```

### รัน test

```bash
cd backend
npm test          # ทดสอบทั้ง Phase 3 + 4 (100 tests)
npm run check     # ตรวจ syntax ทุกไฟล์ (14 ไฟล์)
npm audit --omit=dev  # ตรวจ vulnerability
```

---

## 5. ตัวแปรในไฟล์ .env ที่ต้องใช้

| ตัวแปร | ค่า default | หมายเหตุ |
|--------|------------|---------|
| `PEXELS_API_KEY` | (ว่าง) | **จำเป็น** ถ้าต้องการรูปจริง; ถ้าว่างจะใช้ fallback |
| `PEXELS_HTTP_TIMEOUT_MS` | `15000` | timeout ต่อ request (ms) |
| `PEXELS_HTTP_RETRIES` | `2` | จำนวน retry เมื่อ request ล้มเหลว |
| `PEXELS_KEYWORD_DELAY_MS` | `500` | หน่วงระหว่าง keyword เพื่อ rate limit |

---

## 6. วิธีทำงานของ Pexels Client (`pexels.client.js`)

- ใช้ **native fetch** (Node 20+) ไม่เพิ่ม dependency
- ตั้ง `Authorization: <apiKey>` header — ไม่ log header เด็ดขาด (logger redact)
- เรียก `GET /v1/search?query=...&per_page=15&orientation=landscape`
- ค้นหาเฉพาะรูปแนวนอน (`orientation=landscape`)
- **ไม่ดาวน์โหลดหรือเก็บไฟล์รูป** — เก็บเฉพาะ URL + metadata
- ถ้าไม่มี `PEXELS_API_KEY`: log warn และคืน `[]` (ไม่ crash)
- **[QC fix] เรียก `rateLimiter.acquire()`** ก่อนทุก real API call — throw ถ้าเกิน limit
- DI hook `_mockPhotos` สำหรับ test (ไม่ต้องเรียก API จริง)

---

## 7. วิธีสร้าง Image Search Keywords (`keywords.js`)

ลำดับ keyword:

1. **AI keywords** — `news.imageSearchKeywords` จาก rewriter (ก่อนเสมอ)
2. **Static topic map** — match จาก title + category ของข่าว:
   - gold/silver → `"gold bars"`, `"silver coins"`
   - fed/central bank → `"Federal Reserve building"`
   - inflation/CPI → `"inflation economy prices"`
   - interest rate → `"interest rate bank finance"`
   - mining → `"gold mining operation"`
   - dollar/DXY → `"US dollar currency"`
   - copper/platinum → commodity-specific keywords
3. **Generic fallback** — `"financial market trading"` ถ้ายังไม่ครบ

ข้อจำกัด:
- **ห้ามส่งเนื้อหาข่าวทั้งหมด** — ใช้เฉพาะ title + category เพื่อ topic matching
- Normalize: lowercase, trim, ตัด special chars, จำกัด 60 chars/keyword
- Deduplicate + จำกัดสูงสุด **5 keywords**

---

## 8. วิธีจัดอันดับรูปภาพ (`ranking.js`)

### Score Function — Technical Suitability (ไม่ใช่ Semantic Relevance)

> **สำคัญ:** `scorePhoto` วัดความเหมาะสม**ทางเทคนิค**เท่านั้น ไม่ได้วัดว่ารูป
> เกี่ยวข้องกับเนื้อข่าวหรือไม่ Pexels เป็น image search engine ไม่ใช่ news-aware system
> Keyword ที่ใช้ค้นหาเป็น search signal เท่านั้น ไม่ใช่การยืนยัน content match

| องค์ประกอบ | คะแนน |
|-----------|-------|
| Landscape (w ≥ h) | +50 |
| ความละเอียด (w < 800px) | 0 (ตัดทิ้ง) |
| Resolution bonus: `min(floor(w/100), 20)` | +0 ถึง +20 |
| Aspect ratio ≈ 16:9 (diff < 0.1) | +15 |
| Aspect ratio ≈ 16:9 หรือ 4:3 (diff < 0.3) | +8 |
| Aspect ratio ใกล้เคียง (diff < 0.6) | +3 |

**SCORE_THRESHOLD = 60**

- score ≥ 60 → `reviewRequired = false`
- score < 60 → `reviewRequired = true`

### Deduplication

ก่อนจัดอันดับ: `deduplicatePhotos(photos)` ตัดรูปซ้ำ `photo.id` จากหลาย keyword รักษาลำดับแรกที่พบ

**สิ่งที่ scorePhoto ไม่วัด:**
- ❌ ไม่วัดว่ารูปเกี่ยวกับเนื้อข่าวแค่ไหน (semantic relevance)
- ❌ ไม่วัดว่า keyword ตรงกับเนื้อหาข่าว
- ❌ Pexels ไม่สามารถ match เนื้อข่าว 100% (Pexels ค้นหาตาม keyword ภาพ ไม่ใช่เนื้อหา)

---

## 9. วิธีทำงานของ Fallback

เมื่อหารูปไม่ได้:

```js
// FALLBACK_IMAGE (จาก pexels.client.js)
{
  imageUrl: '',            // ว่าง — ใช้ template image ใน Frontend
  imageSource: 'Pexels',
  imageAuthor: '',
  imageAuthorUrl: 'https://www.pexels.com',
  imageLicense: 'Pexels License',
  imageSourceUrl: 'https://www.pexels.com',
  imageSearchKeywords: []  // keywords ที่พยายามค้นหา
}
```

**กรณีที่ trigger fallback:**
- ไม่มี `PEXELS_API_KEY` → Pexels client คืน `[]` → fallback
- Pexels คืนรูปว่าง (`photos = []`) → fallback
- รูปทั้งหมดเป็น portrait หรือความละเอียดต่ำ → ไม่ผ่าน ranking → fallback

---

## 10. วิธีจัดการ Timeout, Retry และ Rate Limit

### Timeout + Retry (Pexels client)

```
attempt 0: fetch(url, { signal: AbortController(timeoutMs) })
  ล้มเหลว → sleep(1000ms) → attempt 1
  ล้มเหลว → sleep(2000ms) → attempt 2
  ล้มเหลว ทุก retry → throw Error
```

- timeout default: **15,000ms** (ตั้งค่าได้ด้วย `PEXELS_HTTP_TIMEOUT_MS`)
- retries default: **2** (ตั้งค่าด้วย `PEXELS_HTTP_RETRIES`)
- backoff: `1000 * (attempt + 1)` ms

### keyword delay (ไม่ใช่ rate limiter)

`PEXELS_KEYWORD_DELAY_MS=500` เป็นเพียงการหน่วงระหว่าง keyword ในรอบเดียว
ไม่ใช่ global rate limit — ใช้คู่กับ `rateLimiter` เสมอ

---

## 11. รูปแบบ Metadata ของรูปภาพ

```ts
{
  // *** status + review (แยกอิสระจากกัน) ***
  status: 'selected' | 'fallback' | 'failed',
  reviewRequired: boolean,

  // *** image metadata (ครบทุก field ที่กำหนด) ***
  imageUrl: string,         // URL รูปขนาด large2x (หรือใหญ่สุดที่มี)
  imageSource: 'Pexels',   // แหล่งที่มา (คงที่)
  imageAuthor: string,      // ชื่อช่างภาพ
  imageAuthorUrl: string,   // Profile URL ช่างภาพบน Pexels
  imageLicense: 'Pexels License',  // License (คงที่)
  imageSourceUrl: string,   // URL หน้ารูปบน Pexels
  imageSearchKeywords: string[], // keywords ที่ใช้ค้นหา (reference)
}
```

**หมายเหตุ:** ไม่มีการดาวน์โหลดหรือเก็บไฟล์รูป เก็บเฉพาะ URL + metadata

---

## 12. รายละเอียดสถานะ

| status | reviewRequired | ความหมาย |
|--------|----------------|---------|
| `selected` | `false` | ได้รูปจาก Pexels, score ≥ 60 (พร้อมใช้) |
| `selected` | `true` | ได้รูปจาก Pexels แต่ score < 60 (ควรตรวจก่อนใช้) |
| `fallback` | `true` | ไม่มี API key หรือ Pexels ไม่มีรูปที่เหมาะสม |
| `failed` | `true` | API ล้มเหลวทุก retry (network error) |

**กฎที่บังคับ:**
- `needs_review` **ห้ามใช้เป็น status** (ใช้ `reviewRequired=true` แทน)
- `fallback` และ `failed` → `reviewRequired=true` เสมอ (ไม่มีข้อยกเว้น)
- `selected` + `reviewRequired=false` = เดียวที่ใช้ได้โดยไม่ต้องตรวจ (Phase 5 ตัดสินใจเผยแพร่)

---

## 13. ผลการทดสอบทั้งหมด

### Test Suites — ผลจริง (26 suites, 115 tests รวม Phase 3+4)

> **หมายเหตุ:** `npm test` รัน `test/phase3.test.js` + `test/phase4.test.js` พร้อมกัน
> ตัวเลขด้านล่างคือ **115 tests total**
> ไม่มีการเรียก Pexels API จริงระหว่าง test ทั้งหมด — ใช้ mock/DI hook

| # | Suite | Tests | ผล |
|---|-------|------:|-----|
| 1 | keyword generation | 9 | ✅ |
| 2 | scorePhoto (technical suitability) | 5 | ✅ |
| 3 | deduplicatePhotos | 5 | ✅ |
| 4 | selectBestPhoto + score threshold | 4 | ✅ |
| 5 | mapPhotoToMetadata completeness | 9 | ✅ |
| 6 | pipeline status=selected | 4 | ✅ |
| 7 | pipeline status=fallback | 3 | ✅ |
| 8 | pipeline status=failed | 2 | ✅ |
| 9 | pipeline deduplication | 1 | ✅ |
| 10 | reviewRequired แยกจาก status | 4 | ✅ |
| 11 | keywords ไม่มี imageSearchKeywords | 2 | ✅ |
| 12 | ImageStatus constants | 1 | ✅ |
| **13** | **[QC fix] Global rate limiter** | **11** | ✅ |
| **14** | **[QC fix] Technical suitability vs semantic** | **4** | ✅ |
| Phase 3 (regression, 12 suites) | — | 51 | ✅ |
| **รวมทั้งหมด** | | **115 tests total** | ✅ |


---

## 14. ผล npm test

```
# tests 115
# suites 26
# pass 115
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 116.9129
```

✅ **115/115 ผ่าน** (Phase 3 + Phase 4 รวมกัน)

> ไม่มีการเรียก Pexels API จริงในระหว่าง test — ทั้งหมดใช้ mock/DI hook

---

## 15. ผล npm run check

```
> node --check src/...image/keywords.js
  && node --check src/image/ranking.js
  && node --check src/image/pexels.client.js
  && node --check src/image/imagePipeline.js
  && node --check src/image/rateLimiter.js
  && echo 'syntax OK'

'syntax OK'
```

✅ **syntax OK (15 ไฟล์)**

---

## 16. ผล npm audit --omit=dev

```
found 0 vulnerabilities
```

✅ **0 vulnerabilities**

---

## 17. กรณีที่ทดสอบด้วย Mock

ทุก test ใช้ DI hook `_mockSearchFn` แทนการเรียก Pexels API จริง:

```js
// inject mock search function (คืนรูปที่กำหนด)
await findImageForNews(news, {
  _mockSearchFn: async (query) => [photo1, photo2],
  delayMs: 0,  // ไม่ต้อง delay ใน test
});

// inject mock ที่ throw (simulate API failure)
await findImageForNews(news, {
  _mockSearchFn: async () => { throw new Error('network error'); },
  delayMs: 0,
});
```

กรณีที่ทดสอบด้วย mock:
- **รูปดี** (1920x1080 16:9) → status=selected, reviewRequired=false ✅
- **รูปว่าง** (`[]`) → status=fallback ✅
- **portrait เท่านั้น** → ตัดทิ้งทั้งหมด → status=fallback ✅
- **API throw** → status=failed ✅
- **รูปซ้ำ photo.id จากหลาย keyword** → dedup ถูกต้อง ✅
- **score threshold boundary** (60-1=59 → true, 60 → false) ✅

ไม่มีการเรียก Pexels API จริงหรือเสียค่าใช้จ่ายใดๆ ระหว่าง QC

---

## 18. ปัญหาหรือข้อจำกัดที่ยังเหลือ

1. **Keyword relevance ไม่สมบูรณ์** — Pexels ค้นหาตาม keyword ภาพ ไม่ใช่เนื้อหาข่าว รูปที่ได้อาจไม่ตรงกับเนื้อข่าว 100% (ระบุใน metadata + reviewRequired)

2. **ไม่มี integration test กับ Pexels จริง** — Phase 4 ทดสอบด้วย mock เท่านั้น ต้องทดสอบ API จริงเมื่อมี key

3. **`imageUrl` ว่างเมื่อ fallback** — Frontend Phase 6 ต้องจัดการแสดงรูป default เอง

4. **Phase 5 ยังไม่ได้ integrate** — `findImageForNews()` ยังไม่ถูกเรียกจากที่ใดใน pipeline จริง (รอ Phase 5)

5. **Rate limit ข้าม process** — `rateLimiter` singleton ครอบคลุมทุก call ใน process เดียวกัน แต่ **ไม่ครอบคลุมข้าม Node process** (multi-worker/container) — Phase 5 Scheduler ควรควบคุมที่ระดับนั้น

---

## 19. ความเสี่ยงที่ควรให้ Codex ตรวจ

1. **`_mockSearchFn` DI hook** — ใช้ pattern เดียวกับ Phase 3 (`_testRewriteResponse`) แต่ใช้ `typeof opts._mockSearchFn === "function"` แทน `!== undefined` — ควรตรวจว่า production path ไม่สามารถ inject ได้โดยไม่ตั้งใจ

2. **`w < h` check สำหรับ square (w === h)** — รูปสี่เหลี่ยมจัตุรัส (w=h) จะผ่าน landscape check (w < h = false) → ได้คะแนนต่ำ (ratio=1.0, diff43=0.333 → +3; score≈61) ซึ่งอาจ reviewRequired=false ขึ้นกับ resolution — ควร Codex พิจารณาว่าต้องการ filter square ออกหรือไม่

3. **`PEXELS_KEYWORD_DELAY_MS=500` default** — เป็น delay ระหว่าง keyword เพื่อลด burst rate เท่านั้น — **ไม่ใช่ rate limiter** ใช้คู่กับ `rateLimiter.acquire()` เสมอ ถ้า Phase 5 เรียกบ่อยขึ้น ควรปรับ

4. **`imageSearchKeywords` จาก AI อาจว่าง** — ถ้าข่าวผ่าน mock mode (Phase 3 mock) `imageSearchKeywords` จะว่างหรือมีแค่ `["gold bars financial market"]` ระบบ fallback ไป static topic map ซึ่งทำงานได้ แต่ควรตรวจสอบ

5. **Authorization header format** — Pexels ใช้ `Authorization: <key>` (ไม่มี "Bearer") แตกต่างจาก OpenAI — ควรตรวจสอบกับ Pexels documentation จริงก่อน deploy

---

## 20. สิ่งที่ยังไม่ได้ทำ

- ❌ Phase 5 — Database + Scheduler (รอ Codex อนุมัติ)
- ❌ Phase 6 — Frontend (รอ Codex อนุมัติ)
- ❌ Phase 7 — E2E Testing (รอ Codex อนุมัติ)
- ⏳ ทดสอบ Pexels API จริง (ต้องมี PEXELS_API_KEY ใน .env)
- ⏳ integrate `findImageForNews()` เข้ากับ AI pipeline จริง (Phase 5)

---

## 🚫 ข้อห้ามที่ปฏิบัติครบทุกข้อ

| ข้อ | สถานะ |
|------|-------|
| ไม่เพิ่ม Database | ✅ |
| ไม่เพิ่ม Scheduler | ✅ |
| ไม่สร้าง API server | ✅ |
| ไม่แก้ Frontend | ✅ |
| ไม่แก้ระบบ OpenAI Phase 3 (ยกเว้น bug) | ✅ |
| ไม่ใช้ Google Images | ✅ |
| ไม่ใช้รูปจาก Kitco | ✅ |
| ไม่ส่งเนื้อหาข่าวทั้งหมดไป Pexels | ✅ (ส่งเฉพาะ keyword สั้น) |
| ไม่ดาวน์โหลดหรือเก็บไฟล์รูป | ✅ (เก็บเฉพาะ URL + metadata) |
| ไม่เพิ่ม dependency โดยไม่จำเป็น | ✅ (ใช้ native fetch) |
| API key อยู่ใน .env เท่านั้น | ✅ |
| ไม่ใช้ `needs_review` เป็น status | ✅ |

---

## หยุดรอ QC

ไม่เริ่ม Phase 5 / Database / Scheduler / Frontend จนกว่า Codex ตรวจ QC Phase 4 ผ่าน
