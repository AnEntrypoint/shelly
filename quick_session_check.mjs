import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3000');

  console.log('Entering password...');
  await page.fill('input[type="password"]', 'smooth_20fps_final');
  
  const connectBtn = await page.$('button:has-text("Connect")');
  if (connectBtn) {
    await connectBtn.click();
    
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      const sessionStatus = await page.evaluate(() => {
        const tabs = document.querySelectorAll('[id^="tab-"]');
        const vncBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('VNC'));
        return {
          tabCount: tabs.length,
          vncEnabled: vncBtn && !vncBtn.disabled,
          bodyText: document.body.innerText.substring(0, 100)
        };
      });

      console.log(`[${i}s] Tabs: ${sessionStatus.tabCount}, VNC enabled: ${sessionStatus.vncEnabled}`);
      
      if (sessionStatus.tabCount > 0 && sessionStatus.vncEnabled) {
        console.log('✓ Session loaded and VNC ready!');
        break;
      }
    }
  }

  await browser.close();
})();
