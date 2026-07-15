# Phase 9 — Backend Auto Pilot MVP

อัปเดตล่าสุด: 15 กรกฎาคม 2026

เอกสารนี้สรุปการพัฒนา Phase 9: Backend Auto Pilot MVP — ระบบดึงข่าว Kitco →
ตรวจสอบ → AI rewrite → ตรวจรูป → publish อัตโนมัติเฉพาะข่าวที่ผ่าน Safety Gate ครบทุกข้อ

**หมายเหตุสำคัญ:** Phase นี้เป็น Backend MVP เท่านั้น — ยังไม่มี UI (ตามข้อกำหนด)
การควบคุมผ่าน Admin API (ต้องมี ADMIN_TOKEN ฝั่ง server เท่านั้น)

---

## หลักการ Safety (บังคับ)

1. **default disabled** — env `AUTO_PILOT_ENABLED=false` + DB `enabled=0`
   ต้อง env+DB อนุญาตทั้งคู่จึงรันจริง
2. **No-Fallback Policy** (สืบทอดจาก Phase 8) — ห้ามใช้ createdAt/publishedAt แทน sourcePublishedAt
3. **Safety Gate 16 ข้อ** — ห้าม bypass; ห้าม publish needs_review/rejected/failed/mock/missing-sourcePublishedAt
4. **Atomic lock** — in-process flag + DB atomic CAS (ไม่ hold transaction ค้าง)
5. **Emergency stop** — DB flag atomic; เช็คก่อนเริ่มข่าวถัดไป
6. **Audit ทุก stage** — append-only, no secret (scrub ก่อน insert)
7. **ADMIN_TOKEN server-side only** — ห้ามเปิดเผยใน frontend/response

---

## State Machine

```
                 enable() (env+DB allow)
   off ───────────────────────────────► idle
    ▲                                     │
    │ disable()                           │ runOnce() acquire lock
    │                                     ▼
    │                                  running
    │                                     │
    │              ┌──────────────────────┼──────────────────────┐
    │              │                      │                      │
    │         run success            emergency stop        system error
    │         releaseLock('idle')    releaseLock('idle')   releaseLock('stopped_error')
    │              │                      │                      │
    └──────────────┴──────────────────────┴──────────► idle / stopped_error
```

**Bootstrap safety:** ถ้า process restart ขณะ status='running' (crash ระหว่างรอบ)
migration v3 จะ auto-release → status='stopped_error' + last_error บันทึกไว้

---

## ไฟล์ที่แก้ไข/สร้าง

### สร้างใหม่ (5)
| ไฟล์ | หน้าที่ |
|------|--------|
| `backend/src/store/autoPilotRepository.js` | settings + atomic lock (CAS) + emergency stop |
| `backend/src/store/auditRepository.js` | append-only audit log + secret scrubbing |
| `backend/src/autopilot/autoPilot.js` | Auto Pilot service (state machine + runOnce) |
| `backend/test/phase9.test.js` | 15 tests (13 เคสหลัก + 2 extra) |
| `backend/PHASE9-SUMMARY.md` | ไฟล์นี้ |

### แก้ไข (6)
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `backend/src/config/env.js` | เพิ่ม `config.autoPilot` (enabled/intervalMinutes/maxPerRun default off) |
| `backend/src/store/migration.sql` | เพิ่ม `auto_pilot_settings` + `auto_pilot_audit` tables + indexes |
| `backend/src/store/db.js` | migration v3: bootstrap singleton + auto-release crash lock |
| `backend/src/pipeline/runNewsUpdate.js` | `evaluateSafetyGate` (16 gates) + `isReadyForAutoPublish` wrapper |
| `backend/src/api/server.js` | 5 admin endpoints `/api/admin/auto-pilot/*` |
| `backend/src/server.js` | wire-up repos + autoPilot + autoPilotScheduler |
| `backend/package.json` | `check` list เพิ่ม 3 ไฟล์ใหม่ |

---

## Admin Endpoints

ทุก endpoint ต้องมี `Authorization: Bearer <ADMIN_TOKEN>` (ตรวจ timing-safe compare)
ห้ามเปิดเผย ADMIN_TOKEN ใน response ใดๆ

| Method | Endpoint | หน้าที่ |
|--------|----------|--------|
| GET | `/api/admin/auto-pilot/status` | สถานะปัจจุบัน + recent audit 5 รายการ |
| POST | `/api/admin/auto-pilot/enable` | เปิด (409 ถ้า env ปิด หรือ emergency active) |
| POST | `/api/admin/auto-pilot/disable` | ปิด |
| POST | `/api/admin/auto-pilot/emergency-stop` | ตั้ง emergency stop (รอบปัจจุบันหยุดก่อนข่าวถัดไป) |
| POST | `/api/admin/auto-pilot/clear-emergency` | ล้าง emergency stop |
| POST | `/api/admin/auto-pilot/run-once` | สั่งรันรอบเดียว (202 accepted, async) |

### ตัวอย่าง response (status)
```json
{
  "envAllowed": false,
  "enabled": false,
  "status": "off",
  "maxPerRun": 3,
  "lastRunAt": null,
  "lastSuccessAt": null,
  "lastError": null,
  "emergencyStop": false,
  "running": false,
  "recentAudit": []
}
```

---

## Safety Gate (16 ข้อ)

ข่าวจะ publish อัตโนมัติได้ต่อเมื่อผ่านทุกข้อ (`evaluateSafetyGate` คืน `{passed:true, reasons:[]}`):

| # | Gate | reason เมื่อไม่ผ่าน |
|---|------|---------------------|
| 1 | source เป็น Kitco trusted | `source_not_trusted:<policy>` |
| 2 | มี sourceUrl | `missing_source_url` |
| 3 | มี sourcePublishedAt ที่ถูกต้อง | `invalid_or_missing_sourcePublishedAt` |
| 4 | ไม่ซ้ำ (ตรวจที่ caller) | `duplicate` |
| 5 | rewrite สำเร็จ (thaiTitle + thaiContent) | `missing_thai_title/content` |
| 6 | deterministic validator ผ่าน | `deterministic_rejected/failed` |
| 7 | ไม่มี unexpected numbers | `numbers_mismatch` |
| 8 | ไม่มีคำแนะนำลงทุน/คำต้องห้าม | `banned_words_found/investment_advice_found` |
| 9 | ไม่มีข้อมูลที่ AI เติม | `added_information_found` |
| 10 | ไม่ใช่ mock mode | `mock_mode` |
| 11 | validationStatus = 'validated' | `validationStatus_not_validated:<status>` |
| 12 | imageStatus = 'selected' | `imageStatus_not_selected:<status>` |
| 13 | imageReviewRequired = false | `image_review_required` |
| 14 | publishStatus ≠ 'published' | `already_published` |
| 15 | อายุข่าว ≤ 48h | `news_too_old:<h>h>48h` |
| 16 | มี credit + sourceUrl + imageUrl ครบ | `missing_credit/image_url/image_source_url` |

ข่าวที่ไม่ผ่าน → audit `publish_blocked` + reason + ทำข่าวถัดไปต่อ

---

## Audit Log Stages

append-only, แต่ละ entry มี: `timestamp, runId, newsId?, stage, status, reason?, metadata?(no secret)`

| Stage | เมื่อใด |
|-------|--------|
| `run_started` | เริ่มรอบ (พร้อม maxPerRun, startedAt) |
| `digest_fetched` | ดึง digest สำเร็จ (count, needsReview) |
| `article_selected` | เลือกข่าวเข้าประมวลผล (sourceUrl, sourcePublishedAt) |
| `article_skipped` | ข้ามข่าว |
| `rewrite_completed` | AI rewrite เสร็จ (validationStatus) |
| `validation_passed` | Safety Gate ผ่าน |
| `validation_failed` | Safety Gate ไม่ผ่าน / process error |
| `image_completed` | image pipeline เสร็จ (imageStatus, reviewRequired) |
| `publish_completed` | publish สำเร็จ |
| `publish_blocked` | publish ถูกบล็อก (reason = gates ที่ไม่ผ่าน) |
| `run_completed` | รอบเสร็จ (published/blocked/failed/stopped) |
| `run_failed` | system error (releaseLock stopped_error) |
| `emergency_stop` | หยุดกลางรอบ (stopped_mid_run) |

---

## ลำดับ Auto Pilot runOnce (13 ขั้น ตามข้อกำหนด)

reuse pipeline เดิม — ห้ามสร้าง logic ซ้ำ:
1. ตรวจ emergency_stop → ถ้าตั้งอยู่ return
2. acquire DB lock (atomic CAS) + in-process flag
3. generate runId + audit run_started
4. `fetchDigest` (ดึง digest จาก Kitco)
5. `selectTopNews` (เรียงด้วย sourcePublishedAt, dedupe)
6. `repo.findDuplicate` (dedupe กับ DB)
7. `fetchArticles` (ดึงบทความเต็ม)
8. `processAndSaveBatch` (source policy + AI rewrite + deterministic validation + AI validation + image)
9. วนทีละข่าว: emergency stop check → audit stages → `evaluateSafetyGate`
10. ถ้าผ่านครบ → `repo.updatePublishStatus` + audit publish_completed
11. ถ้าไม่ผ่าน → audit publish_blocked + ทำข่าวถัดไป
12. error ระดับข่าว → catch + audit + ทำข่าวถัดไป
13. error ระดับระบบ → releaseLock('stopped_error') + lastError + audit run_failed

---

## ผลการทดสอบจริง

### `npm run check`
```
EXIT=0
syntax OK
```
ครอบคลุม 30 ไฟล์รวม 3 ไฟล์ใหม่ (autoPilot.js, autoPilotRepository.js, auditRepository.js)

### `npm test`
```
# tests 207
# suites 35
# pass 207
# fail 0
# duration_ms 657.4563
```
**207 passed, 0 failed** (เพิ่ม phase9 15 tests จาก 192 ของ Phase 8)

### Phase 9 test breakdown (15 tests)
- 13 เคสหลักตามข้อกำหนด (default disabled, env/db gate, lock, maxPerRun, gate pass/fail, error continue, emergency stop, mock, missing sourcePublishedAt, audit, crash recovery)
- 2 extra: Safety Gate unit (16 gates coverage) + audit secret scrubbing

---

## Acceptance Criteria Checklist

| # | ข้อกำหนด | สถานะ | หลักฐาน |
|---|----------|-------|---------|
| 1 | ค่าเริ่มต้นปิด | ✅ | env default false + DB default off (test 1) |
| 2 | DB setting (enabled/status/maxPerRun/lastRun/lastError/emergency/updatedAt) | ✅ | auto_pilot_settings table |
| 3 | 5 admin endpoints + ADMIN_TOKEN auth | ✅ | server.js + test (timing-safe compare) |
| 4 | ป้องกันความผิดพลาด (lock/run-guard/maxPerRun/emergency/error-handling) | ✅ | test 4,5,8,9 |
| 5 | ลำดับ Auto Pilot 13 ขั้น (reuse pipeline) | ✅ | autoPilot.runOnce |
| 6 | Safety Gate 16 ข้อ | ✅ | evaluateSafetyGate + test 6,10,11 + Safety Gate unit |
| 7 | Audit log ครบ stages | ✅ | test 12 + auditRepository |
| 8 | Scheduler (env+db both enabled, no dup, stop/status) | ✅ | server.js autoPilotScheduler |
| 9 | Tests 13 เคส | ✅ | phase9.test.js (15 tests pass) |
| 10 | ข้อห้าม (no V1/V2, no hardcode, no fallback, no bypass, no secret in browser) | ✅ | ปฏิบัติครบ |

---

## สรุป

Phase 9 Backend Auto Pilot MVP พัฒนาเสร็จครบถ้วน — 207 tests ผ่านทั้งหมด
- `npm run check`: ผ่าน (syntax OK)
- `npm test`: **207 passed, 0 failed**
- State machine: off → idle → running → (idle | stopped_error) พร้อม crash recovery
- Safety Gate 16 ข้อบังคับ ห้าม bypass
- Audit log ครบทุก stage (no secret)
- ค่าเริ่มต้นปิดทุกอย่าง (env + DB)

**ยังไม่ได้ทำ UI** (ตามข้อกำหนด — Backend MVP ก่อน) พร้อมส่งให้ Codex ตรวจสอบ QC
หากผ่านจะทำ UI ใน Phase ถัดไป
