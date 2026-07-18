const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.setCookie({
    name: 'admin_token',
    value: 'secret_admin_token',
    domain: '127.0.0.1',
    path: '/',
  });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.goto('http://127.0.0.1:3000/Version-2-Gold-Trading/admin.html?cb=' + Date.now());
  await new Promise(r => setTimeout(r, 2000));

  // Login
  await page.evaluate(() => {
    const input = document.getElementById('adminTokenInput');
    const btn = document.getElementById('adminLoginBtn');
    if (input && btn) {
      input.value = 'oO*515659';
      btn.click();
    }
  });

  await new Promise(r => setTimeout(r, 3000));

  // Check checkboxes
  await page.evaluate(() => {
    const cb = document.querySelector('.adminRowCheck');
    if (cb) {
      cb.click();
      console.log('Checked first row checkbox');
    } else {
      console.log('No checkbox found');
    }
  });

  await new Promise(r => setTimeout(r, 1000));

  // Try to click bulk delete
  await page.evaluate(() => {
    const btn = document.querySelector('button[data-act="bulk-delete"]');
    if(btn) {
      console.log('Found bulk delete btn, clicking');
      btn.click();
    } else {
      console.log('No bulk delete btn');
    }
  });

  await new Promise(r => setTimeout(r, 1000));

  // Try to click confirm in the modal
  await page.evaluate(() => {
    const confirmBtn = document.querySelector('.admin-confirm-overlay button[data-act="confirm"]');
    if(confirmBtn) {
      console.log('Found confirm button in modal, clicking');
      confirmBtn.click();
    } else {
      console.log('No confirm button found in modal');
    }
  });

  await new Promise(r => setTimeout(r, 2000));

  // Read notice
  const notice = await page.evaluate(() => {
    const el = document.querySelector('.admin-notice');
    return el ? el.innerText : 'No notice';
  });
  console.log('NOTICE AFTER:', notice);

  await browser.close();
})();
