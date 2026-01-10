import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleLogs = [];

  page.on('console', msg => {
    const logText = msg.text();
    consoleLogs.push(logText);
    if (logText.includes('H.264') || logText.includes('Box') || logText.includes('error')) {
      console.log(`[BROWSER] ${logText}`);
    }
  });

  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log('\n=== CONNECTING TO SERVER ===');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  console.log('=== ENTERING PASSWORD ===');
  await page.fill('input[type="password"]', 'vnc_display_test');
  const connectBtn = await page.$('button:has-text("Connect")');
  if (connectBtn) {
    await connectBtn.click();
    console.log('Waiting for session to connect...');
    await page.waitForTimeout(5000);
  }

  console.log('=== OPENING VNC MODAL ===');
  const sessionInfo = await page.evaluate(() => {
    const tabs = document.querySelectorAll('[id^="tab-"]').length;
    const vncBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('VNC'));
    return {
      tabs: tabs,
      vnc_btn_disabled: vncBtn ? vncBtn.disabled : 'not found'
    };
  });
  console.log(`Sessions loaded: ${sessionInfo.tabs} tabs`);
  console.log(`VNC button enabled: ${!sessionInfo.vnc_btn_disabled}`);

  if (!sessionInfo.vnc_btn_disabled) {
    const vncBtn = await page.$('button:has-text("VNC")');
    await vncBtn.click();
    console.log('Clicked VNC button, waiting for modal...');
    await page.waitForTimeout(5000);

    const videoInfo = await page.evaluate(() => {
      const video = document.getElementById('h264-video');
      const modal = document.getElementById('vnc-modal');
      return {
        video_exists: !!video,
        modal_active: modal ? modal.classList.contains('active') : false,
        video_src_type: video ? (video.src ? 'has_src' : 'no_src') : 'no_video'
      };
    });
    console.log(`Video element exists: ${videoInfo.video_exists}`);
    console.log(`Modal is active: ${videoInfo.modal_active}`);
    console.log(`Video src type: ${videoInfo.video_src_type}`);

    console.log('\n=== TAKING SCREENSHOT ===');
    await page.screenshot({ path: '/tmp/h264_display_final.png', fullPage: false });
    console.log('Screenshot saved to /tmp/h264_display_final.png');

    console.log('\n=== H.264 STREAMING STATUS ===');
    const h264Logs = consoleLogs.filter(l => l.includes('H.264') || l.includes('Box'));
    console.log(`H.264 messages received: ${h264Logs.length}`);
    if (h264Logs.length > 0) {
      h264Logs.slice(0, 5).forEach(log => console.log(`  - ${log}`));
    }
  }

  await browser.close();
  console.log('\n=== TEST COMPLETE ===\n');
})();
