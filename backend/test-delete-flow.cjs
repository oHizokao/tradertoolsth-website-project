/*
 * QC test for delete button fix (Single + Bulk delete via Custom Modal)
 *
 * วิธีรัน:
 *   1) backend ต้องรันอยู่ที่ http://127.0.0.1:3000
 *   2) node backend/test-delete-flow.cjs
 *
 * จำลอง user flow จริง:
 *   - เข้าหน้า admin.html
 *   - login ผ่าน UI (input + click)
 *   - รอ render ตารางข่าว
 *   - ถ้าไม่มีข่าวเลย → แจ้งเตือนและจบการทดสอบ
 *   - CASE A (Single): จับคู่ข่าว 1 รายการ → คลิก "ลบ" → ตรวจ Modal → คลิก confirm → ตรวจ notice + row count
 *   - CASE B (Bulk)  : เลือกข่าว 2-3 รายการผ่าน checkbox → คลิก "ลบที่เลือก" → ตรวจ Modal + จำนวน → คลิก confirm → ตรวจ notice + row count
 *   - รวบรวม console log และผลลัพธ์สำหรับรายงาน QC
 */
const puppeteer = require('puppeteer');

const BASE = 'http://127.0.0.1:3000';
const URL = `${BASE}/Version-2-Gold-Trading/admin.html?cb=${Date.now()}`;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'oO*515659';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readNotice(page) {
  return await page.evaluate(() => {
    const el = document.querySelector('.admin-notice');
    if (!el) return { present: false };
    return {
      present: true,
      text: (el.innerText || '').trim(),
      className: el.className,
      type: el.dataset.type || null,
    };
  });
}

async function getRowCount(page) {
  return await page.evaluate(() => document.querySelectorAll('.admin-news-table tbody tr').length);
}

async function getRowIds(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('.adminRowCheck')).map((cb) => cb.dataset.id)
  );
}

async function login(page) {
  await page.evaluate((token) => {
    const input = document.getElementById('adminTokenInput');
    const btn = document.getElementById('adminLoginBtn');
    if (input && btn) {
      input.value = token;
      btn.click();
    } else {
      throw new Error('login elements missing');
    }
  }, ADMIN_TOKEN);
  await sleep(2500);
}

(async () => {
  const result = {
    startedAt: new Date().toISOString(),
    url: URL,
    cases: [],
    consoleLogs: [],
    errors: [],
  };

  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new' });
  } catch (e) {
    result.errors.push({ stage: 'launch', message: e.message });
    console.log(JSON.stringify(result, null, 2));
    process.exit(2);
  }

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      const text = msg.text();
      result.consoleLogs.push(text);
      console.log('[PAGE]', text);
    });
    page.on('pageerror', (err) => {
      result.errors.push({ stage: 'pageerror', message: err.message });
      console.log('[PAGE ERROR]', err.message);
    });

    console.log('→ goto', URL);
    await page.goto(URL, { waitUntil: 'networkidle2' });
    await sleep(1500);

    console.log('→ login via UI');
    await login(page);
    await sleep(1500);

    // ตรวจสอบว่า login สำเร็จ (ต้องเจอตารางหรือ bulk toolbar)
    const authed = await page.evaluate(
      () => !!document.querySelector('.admin-news-table, .admin-bulk-toolbar, [data-act="bulk-delete"]')
    );
    if (!authed) {
      result.errors.push({ stage: 'login', message: 'login ไม่สำเร็จ — ไม่พบตารางข่าวหลัง login' });
      throw new Error('login failed');
    }

    // รอให้ render news rows
    await sleep(1500);
    let ids = await getRowIds(page);
    console.log('→ row ids:', ids.length);

    if (ids.length === 0) {
      result.errors.push({
        stage: 'data',
        message: 'ไม่มีข่าวในฐานข้อมูลสำหรับทดสอบ — รัน auto-pilot หรือเพิ่มข่าวก่อน',
      });
      console.log('!! no rows — aborting');
      await browser.close();
      result.finishedAt = new Date().toISOString();
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    // ---------------------------------------------------------------
    // CASE A: Single Delete (handleDeleteOne)
    // ---------------------------------------------------------------
    try {
      const beforeCount = await getRowCount(page);
      const targetId = ids[0];
      console.log(`→ [CASE A] single delete target id=${targetId} (rows before=${beforeCount})`);

      const clicked = await page.evaluate((id) => {
        const btn = document.querySelector(`button[data-act="delete"][data-id="${id}"]`);
        if (!btn) return false;
        btn.click();
        return true;
      }, targetId);

      if (!clicked) throw new Error('ไม่พบปุ่ม "ลบ" ของรายการแรก');
      await sleep(500);

      // ตรวจ Modal: ต้องมี overlay + ปุ่ม data-act="confirm"
      const modalState = await page.evaluate(() => {
        const overlay = document.querySelector('.admin-confirm-overlay');
        if (!overlay) return { present: false };
        const titleEl = overlay.querySelector('.admin-confirm__title');
        const bodyEl = overlay.querySelector('.admin-confirm__body');
        const confirmBtn = overlay.querySelector('button[data-act="confirm"]');
        const cancelBtn = overlay.querySelector('button[data-act="cancel"]');
        return {
          present: true,
          title: titleEl ? titleEl.innerText.trim() : null,
          body: bodyEl ? bodyEl.innerText.trim() : null,
          hasConfirm: !!confirmBtn,
          hasCancel: !!cancelBtn,
          confirmLabel: confirmBtn ? confirmBtn.innerText.trim() : null,
        };
      });

      const caseA = { name: 'single-delete', targetId, beforeCount, modal: modalState };

      if (!modalState.present || !modalState.hasConfirm) {
        caseA.error = 'Modal ไม่ปรากฏ หรือไม่มีปุ่ม confirm';
        result.cases.push(caseA);
      } else {
        console.log('   modal OK title="' + modalState.title + '" label="' + modalState.confirmLabel + '"');
        // คลิก confirm
        await page.evaluate(() => {
          const b = document.querySelector('.admin-confirm-overlay button[data-act="confirm"]');
          if (b) b.click();
        });
        await sleep(2500);

        const notice = await readNotice(page);
        const afterCount = await getRowCount(page);
        caseA.notice = notice;
        caseA.afterCount = afterCount;
        caseA.deletedRow = afterCount === beforeCount - 1;
        console.log(`   afterCount=${afterCount} notice.present=${notice.present} notice.text="${notice.text || ''}"`);
        result.cases.push(caseA);
      }
    } catch (e) {
      result.cases.push({ name: 'single-delete', error: e.message });
      console.log('   [CASE A ERROR]', e.message);
    }

    // รอ auto-refresh settle
    await sleep(800);

    // ---------------------------------------------------------------
    // CASE B: Bulk Delete (handleBulkDelete)
    // ---------------------------------------------------------------
    try {
      ids = await getRowIds(page);
      const pickN = Math.min(2, ids.length);
      const pickIds = ids.slice(0, pickN);
      const beforeCount = await getRowCount(page);
      console.log(`→ [CASE B] bulk delete ids=${JSON.stringify(pickIds)} (rows before=${beforeCount})`);

      if (pickIds.length < 2) {
        console.log('   ข่าวเหลือน้อยเกินไปสำหรับ bulk multi — จะทดสอบ single-item bulk แทน');
      }

      // tick checkboxes
      for (const id of pickIds) {
        await page.evaluate((x) => {
          const cb = document.querySelector(`.adminRowCheck[data-id="${x}"]`);
          if (cb && !cb.checked) cb.click();
        }, id);
        await sleep(150);
      }
      await sleep(400);

      // คลิก bulk-delete (toolbar ปรากฏเฉพาะตอน someSelected)
      const bulkClicked = await page.evaluate(() => {
        const b = document.querySelector('button[data-act="bulk-delete"]');
        if (!b) return false;
        b.click();
        return true;
      });
      if (!bulkClicked) throw new Error('ไม่พบปุ่ม "ลบที่เลือก" หลังเลือก checkbox');
      await sleep(500);

      const modalState = await page.evaluate(() => {
        const overlay = document.querySelector('.admin-confirm-overlay');
        if (!overlay) return { present: false };
        const titleEl = overlay.querySelector('.admin-confirm__title');
        const bodyEl = overlay.querySelector('.admin-confirm__body');
        const confirmBtn = overlay.querySelector('button[data-act="confirm"]');
        return {
          present: true,
          title: titleEl ? titleEl.innerText.trim() : null,
          body: bodyEl ? bodyEl.innerText.trim() : null,
          hasConfirm: !!confirmBtn,
          confirmLabel: confirmBtn ? confirmBtn.innerText.trim() : null,
        };
      });

      const caseB = {
        name: 'bulk-delete',
        pickIds,
        beforeCount,
        modal: { ...modalState, expectedCount: pickIds.length },
      };

      if (!modalState.present || !modalState.hasConfirm) {
        caseB.error = 'Bulk Modal ไม่ปรากฏ หรือไม่มีปุ่ม confirm';
        result.cases.push(caseB);
      } else {
        // ตรวจว่า modal body ระบุจำนวนถูกต้อง
        const countInBody = (modalState.body || '').match(/(\d+)\s*รายการ/);
        caseB.bodyCountMatches =
          countInBody && Number(countInBody[1]) === pickIds.length;
        console.log(
          `   modal OK title="${modalState.title}" body="${modalState.body}" countMatches=${caseB.bodyCountMatches}`
        );

        // คลิก confirm
        await page.evaluate(() => {
          const b = document.querySelector('.admin-confirm-overlay button[data-act="confirm"]');
          if (b) b.click();
        });
        await sleep(2500);

        const notice = await readNotice(page);
        const afterCount = await getRowCount(page);
        caseB.notice = notice;
        caseB.afterCount = afterCount;
        caseB.deletedRows = afterCount === beforeCount - pickIds.length;
        console.log(
          `   afterCount=${afterCount} notice.present=${notice.present} notice.text="${notice.text || ''}"`
        );
        result.cases.push(caseB);
      }
    } catch (e) {
      result.cases.push({ name: 'bulk-delete', error: e.message });
      console.log('   [CASE B ERROR]', e.message);
    }

    await browser.close();
  } catch (e) {
    result.errors.push({ stage: 'main', message: e.message });
    console.log('[FATAL]', e.message);
    try { await browser.close(); } catch (_) {}
  }

  result.finishedAt = new Date().toISOString();
  console.log('\n========== QC RESULT ==========');
  console.log(JSON.stringify(result, null, 2));
})();
