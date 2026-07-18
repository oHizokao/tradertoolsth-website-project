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
  page.on('dialog', async dialog => {
    console.log('DIALOG:', dialog.type(), dialog.message());
    await dialog.accept();
  });

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

  // Get active operations and errors before click

  // Click delete
  await page.evaluate(() => {
    const btn = document.querySelector('button[data-act="delete"]');
    if(btn) {
      console.log('Found btn, clicking', btn.outerHTML);
      btn.click();
    } else {
      console.log('No btn');
    }
  });

  // Wait for fetch to complete
  await new Promise(r => setTimeout(r, 3000));

  // Read notice
  const notice = await page.evaluate(() => {
    const el = document.querySelector('.admin-notice');
    return el ? el.innerText : 'No notice';
  });
  console.log('NOTICE AFTER:', notice);

  // Read operation history
  const history = await page.evaluate(() => {
    const el = document.querySelector('#adminActivityPanel');
    return el ? el.innerText : 'No history';
  });
  console.log('HISTORY AFTER:', history);

  await browser.close();
})();
