const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

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

  // Try to click delete on first row
  await page.evaluate(() => {
    const btn = document.querySelector('button[data-act="delete"]');
    if(btn) {
      console.log('Found btn, clicking', btn.outerHTML);
      btn.click();
    } else {
      console.log('No btn');
    }
  });

  await new Promise(r => setTimeout(r, 1000));
  await browser.close();
})();
