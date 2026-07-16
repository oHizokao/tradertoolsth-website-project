# Phase 10 — Admin Dashboard สำหรับควบคุม Auto Pilot

อัปเดตล่าสุด: 15 กรกฎาคม 2026

เอกสารนี้สรุปการพัฒนา Phase 10: Admin Dashboard แบบเรียบง่ายสำหรับดูสถานะและสั่งงาน
Auto Pilot ผ่าน Backend API ที่มีอยู่แล้ว (Phase 9)

---

## วิธีเปิดหน้า Admin Dashboard

เริ่ม server พร้อม env ที่จำเป็น:
```powershell
cd backend
$env:ADMIN_TOKEN="วาง_token_สุ่ม_ยาว_ที่นี่"
$env:AUTO_PILOT_ENABLED="true"                # ต้อง true จึงจะเปิด Auto Pilot ได้
$env:ADMIN_ALLOWED_ORIGINS=""                 # ว่าง = ใช้ host ตัวเอง (http://127.0.0.1:3000)
npm start
```

เปิดเบราว์เซอร์ที่ **`http://127.0.0.1:3000/admin`** (หรือ `/v2/admin`, `/Version-2-Gold-Trading/admin.html`)

1. หน้าจะแสดงฟอร์ม login — วาง ADMIN_TOKEN ที่ตั้งไว้ → กด "เข้าสู่ระบบ"
2. ผ่านแล้ว backend ตั้ง HttpOnly cookie → แสดง Dashboard

---

## Endpoint ที่ UI เรียก (ทั้งหมดอยู่ใน `/api/admin/auto-pilot/`)

| Method | Endpoint | Auth | CSRF/Origin | หน้าที่ |
|--------|----------|------|-------------|--------|
| POST | `/login` | ไม่ต้องล่วงหน้า (ตรวจ token ใน body) | ✅ ต้องตรวจ | login → set HttpOnly cookie |
| GET | `/session` | cookie | ❌ (safe method) | ตรวจว่า login แล้วหรือยัง |
| POST | `/logout` | cookie | ✅ | clear cookie |
| GET | `/status` | cookie OR Bearer | ❌ (safe method) | สถานะ + audit ล่าสุด |
| POST | `/enable` | cookie OR Bearer | ✅ | เปิด Auto Pilot |
| POST | `/disable` | cookie OR Bearer | ✅ | ปิด Auto Pilot |
| POST | `/run-once` | cookie OR Bearer | ✅ | สั่งรัน 1 รอบ (async) |
| POST | `/emergency-stop` | cookie OR Bearer | ✅ | หยุดด่วน |
| POST | `/clear-emergency` | cookie OR Bearer | ✅ | ล้าง emergency |

**Cookie attributes:** `HttpOnly`, `Path=/api/admin/auto-pilot`, `SameSite=Strict`,
`Max-Age=28800` (8 ชม.), `Secure` (HTTPS only)

---

## ความปลอดภัย (Safety)

### Auth (ไม่มี secret ใน frontend)
- **HTTP-only cookie** — UI ใส่ token ครั้งเดียวในหน้า login → backend set HttpOnly cookie
  → frontend ไม่สามารถอ่าน token ผ่าน JS ได้ (defense against XSS token theft)
- **token ไม่อยู่ในไฟล์ frontend ใดๆ** (admin.js ไม่มีค่า default)
- Bearer auth คงรองรับสำหรับ script (CI/cron)

### CSRF/Origin protection (defense-in-depth — ห้ามพึ่ง SameSite cookie อย่างเดียว)
- ทุก state-changing endpoint (login/logout/enable/disable/run-once/emergency-stop/clear-emergency)
  ตรวจ `Origin` header (fallback `Referer`) — ต้องตรงกับ host ของ server เอง หรือใน allowlist
- `GET` (status/session) เป็น safe method → ไม่ต้องตรวจ Origin
- allowlist ตั้งผ่าน env `ADMIN_ALLOWED_ORIGINS` (comma-separated, default ว่าง = ใช้ host ตัวเอง)
- Origin ไม่ตรง → `403 origin_not_allowed`

### UI controls (ฝั่ง frontend)
- ปุ่ม **Run disabled ขณะ running** (`disabled` attribute เมื่อ `status.running === true`)
- **Emergency Stop ยืนยัน 2 ขั้น** — กดครั้งแรก arm (label เปลี่ยน "กดอีกครั้งเพื่อยืนยัน",
  auto-reset ใน 5 วินาที), กดครั้งที่สองภายใน 5 วินาทีจึงส่ง request
- **เปิด Auto Pilot ครั้งแรกต้อง confirm** — custom dialog เตือน
  "โหมดนี้จะเผยแพร่ข่าวอัตโนมัติโดยไม่รอคนตรวจสอบ ต้องการเปิดใช่หรือไม่"
- **ห้ามเปิด Auto Pilot เองตอนโหลด** — เช็ค session แล้วแสดง login/dashboard เท่านั้น
- **รีเฟรช → อ่านสถานะจาก backend ใหม่** + auto-refresh ทุก 10 วินาที
- error: 401 → กลับหน้า login; 403 origin → "ไม่อนุญาตให้เรียกจากแหล่งนี้";
  409 → ข้อความไทยตาม error code

### ห้าม bypass Safety Gate
- UI เรียก backend endpoint เท่านั้น — **publish อยู่ฝั่ง Backend ทั้งหมด**
- หน้านี้เป็นเพียงตัวควบคุม ไม่สามารถ bypass Safety Gate 16 ข้อได้

---

## สถานะที่แสดง (badge สีตามสถานะ)

| status | label ไทย | สี badge |
|--------|-----------|----------|
| `off` | ปิดอยู่ | เทา |
| `idle` | พร้อมทำงาน | เขียว (success) |
| `running` | กำลังทำงาน | น้ำเงิน (accent) + pulse animation |
| `stopped_error` | หยุดเนื่องจากข้อผิดพลาด | แดง (danger) |
| `emergencyStop=true` | Emergency Stop | แดงเข้ม (sell) |

## ข้อมูลที่แสดง
- ข่าวสูงสุดต่อรอบ (maxPerRun)
- เวลารันล่าสุด (lastRunAt)
- เวลาที่สำเร็จล่าสุด (lastSuccessAt)
- error ล่าสุด (lastError)
- env allowed / DB enabled flags
- ข่าวที่ publish / blocked / failed (จาก audit recent)
- audit log ล่าสุด 5 รายการ (เวลา/stage/newsId/status/เหตุผล)

---

## ไฟล์ที่แก้ไข/สร้าง

### สร้างใหม่ (4)
| ไฟล์ | หน้าที่ |
|------|--------|
| `Version-2-Gold-Trading/admin.html` | หน้า Admin Dashboard (include design system เดิม) |
| `Version-2-Gold-Trading/admin.js` | logic: login/dashboard/status/controls/audit + CSRF-safe fetch |
| `Version-2-Gold-Trading/styles/admin.css` | status badge variants + control grid + audit table + login/confirm |
| `backend/test/phase10.test.js` | 16 tests (14 เคสหลัก + 2 extra) |
| `backend/PHASE10-SUMMARY.md` | ไฟล์นี้ |

### แก้ไข (3)
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `backend/src/api/server.js` | cookie helpers + Origin check + login/logout/session + auth (cookie OR Bearer) + `/admin` route + (กู้ `/api/news/:id` block ที่หายไประหว่าง refactor) |
| `backend/src/config/env.js` | `adminAllowedOrigins` (env `ADMIN_ALLOWED_ORIGINS`) |
| `backend/src/server.js` | ส่ง `adminAllowedOrigins` ให้ createHttpServer |

---

## ผลการทดสอบจริง

### `npm run check`
```
EXIT=0
syntax OK
```

### `npm test`
```
# tests 223
# suites 35
# pass 223
# fail 0
```
**223 passed, 0 failed** (เพิ่ม phase10 16 tests จาก 207 ของ Phase 9)

### ทดสอบ UI flow จริง (curl จำลอง browser)
รัน server ด้วย `ADMIN_TOKEN=<random>` + `AUTO_PILOT_ENABLED=true`:

| ขั้นตอน | ผล |
|--------|-----|
| POST `/login` (origin ถูก) | `{"ok":true,"authenticated":true}` + Set-Cookie HttpOnly |
| GET `/session` (cookie) | `{"authenticated":true}` |
| POST `/enable` (cookie + origin ถูก) | `{"ok":true,"status":{...,"status":"idle"}}` |
| POST `/run-once` | `{"ok":true,"message":"run-once started"}` |
| POST `/emergency-stop` | ตั้ง emergencyStop=true |
| POST `/clear-emergency` | status กลับ idle |
| POST `/disable` (origin ผิด) | **403 origin_not_allowed** |
| POST `/logout` | `{"authenticated":false}` + clear cookie |
| GET `/admin` | HTTP 200, text/html (1612 bytes) |

**cookie attributes ยืนยัน:** `HttpOnly`, `Path=/api/admin/auto-pilot`, มี token value

### แก้ bug ระหว่างทาง
ระหว่าง refactor block auto-pilot ใน server.js, `/api/news/:id` block ถูกเขียนทับหายไป
→ detail endpoint คืน 404 → phase6 test fail → test runner ค้าง. กู้ block กลับมา
หลัง block `/api/news` (list) → ผ่านครบ

---

## Acceptance Criteria Checklist

| # | ข้อกำหนด | สถานะ | หลักฐาน |
|---|----------|-------|---------|
| 1 | แสดงสถานะ 5 แบบ (off/idle/running/stopped_error/emergency) | ✅ | admin.js renderStatusBadge + badge variants |
| 2 | ปุ่ม 5 ตัว (เปิด/ปิด/รัน/emergency/clear) | ✅ | admin.js bindDashboardControls |
| 3 | confirm เตือน auto-publish ก่อนเปิดครั้งแรก | ✅ | handleEnable → showConfirm |
| 4 | แสดงข้อมูล maxPerRun/lastRun/lastSuccess/error/counts/audit | ✅ | renderDashboard |
| 5 | ห้าม token ใน frontend + UI เรียก backend เท่านั้น | ✅ | cookie HttpOnly + admin.js ไม่มี token default |
| 6 | 401/403/409 แสดงข้อความเข้าใจง่าย | ✅ | error handling ทุก action |
| 7 | Run disabled ขณะ running | ✅ | `${running ? "disabled" : ""}` |
| 8 | Emergency ยืนยัน 2 ขั้น | ✅ | handleEmergencyTwoStep (5s window) |
| 9 | ห้ามเปิด Auto Pilot เองตอนโหลด | ✅ | checkSessionAndRender (แค่อ่าน session) |
| 10 | รีเฟรช → อ่านสถานะจาก backend | ✅ | loadStatusAndRenderDashboard + auto-refresh 10s |
| 11 | ห้าม bypass Safety Gate | ✅ | UI เรียก backend เท่านั้น |
| 12 | Tests (load/enable/disable/run/emergency/401-409/no-secret) | ✅ | phase10.test.js 16 tests pass |
| 13 | ห้ามใช้ ADMIN_TOKEN จริงใน tests | ✅ | makeTestToken() random ทุก test |
| 14 | CSRF/Origin protection (ห้ามพึ่ง SameSite cookie อย่างเดียว) | ✅ | isOriginAllowed + ทุก state-changing ตรวจ |
| 15 | ทดสอบ UI จริง | ✅ | curl flow ผ่านครบ (ตารางข้างต้น) |

---

## สรุป

Phase 10 Admin Dashboard พัฒนาเสร็จครบ — 223 tests ผ่านทั้งหมด + UI flow ทดสอบจริงผ่าน curl
- `npm run check`: ผ่าน (syntax OK)
- `npm test`: **223 passed, 0 failed**
- UI flow: login/cookie/enable/run/emergency/origin-check/logout ผ่านครบ
- ความปลอดภัย: HttpOnly cookie + CSRF/Origin check (defense-in-depth) + ไม่มี secret ใน frontend
- ทดสอบใช้ test token random (ไม่ใช้ ADMIN_TOKEN จริง)

เข้าผ่าน `http://127.0.0.1:3000/admin` พร้อมส่งให้ Codex ตรวจสอบ QC
