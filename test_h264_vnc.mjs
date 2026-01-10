import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log('=== Step 1: Navigate ===');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  console.log('=== Step 2: Enter password and connect ===');
  await page.fill('input[type="password"]', 'h264_test');

  // Find and click the first Connect button
  const connectBtn = await page.$('button:has-text("Connect")');
  if (connectBtn) {
    console.log('Clicking Connect button');
    await connectBtn.click();
    console.log('Waiting for session to connect...');
    await page.waitForTimeout(4000);
  }

  console.log('=== Step 3: Check session status ===');
  const sessionInfo = await page.evaluate(() => {
    const tabs = document.querySelectorAll('[id^="tab-"]');
    const vncBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('VNC'));
    return {
      tabs_count: tabs.length,
      vnc_button_disabled: vncBtn ? vncBtn.disabled : null,
      page_title: document.title
    };
  });
  console.log('Session info:', JSON.stringify(sessionInfo, null, 2));

  console.log('=== Step 4: Open VNC modal ===');
  const vncBtn = await page.$('button:has-text("VNC")');
  if (vncBtn) {
    console.log('Clicking VNC button');
    try {
      await vncBtn.click();
      await page.waitForTimeout(3000);

      // Check video element
      const videoInfo = await page.evaluate(() => {
        const video = document.getElementById('h264-video');
        const modal = document.getElementById('vnc-modal');
        return {
          video_present: !!video,
          modal_visible: modal ? modal.classList.contains('active') : false,
          video_src: video ? video.src : 'no video'
        };
      });
      console.log('Video info:', JSON.stringify(videoInfo));
    } catch (err) {
      console.log('Error clicking VNC button:', err.message);
    }
  }

  console.log('=== Step 5: Take screenshot ===');
  await page.screenshot({ path: '/tmp/h264_vnc_test.png', fullPage: true });
  console.log('Screenshot saved!');

  await browser.close();
})();
