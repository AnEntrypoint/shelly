import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3000');

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[ERROR] ${msg.text()}`);
    }
  });

  console.log('Entering password...');
  const passwordInput = await page.$('input[type="password"]');
  await passwordInput.fill('smooth_20fps_final');
  
  console.log('Clicking Connect...');
  const connectBtn = await page.$('button:has-text("Connect")');
  await connectBtn.click();

  console.log('Waiting for tabs to appear...');
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    const tabCount = await page.evaluate(() => {
      return document.querySelectorAll('[id^="tab-"]').length;
    });
    console.log(`  [${i+1}s] Tabs: ${tabCount}`);
    if (tabCount > 0) break;
  }

  const finalStatus = await page.evaluate(() => {
    const tabsBar = document.getElementById('tabs-bar');
    const tabs = document.querySelectorAll('[id^="tab-"]');
    const tabsContainer = document.getElementById('terminals');
    
    return {
      tabsBarExists: !!tabsBar,
      tabsBarStyle: tabsBar?.style.display,
      tabCount: tabs.length,
      tabIds: Array.from(tabs).map(t => t.id),
      terminalsExists: !!tabsContainer,
      bodyHTML: document.body.innerHTML.substring(0, 200)
    };
  });

  console.log('\nStatus:', JSON.stringify(finalStatus, null, 2));

  await browser.close();
})();
