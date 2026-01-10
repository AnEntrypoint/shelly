import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleLogs = [];

  page.on('console', msg => {
    const logEntry = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(logEntry);
    if (msg.type() !== 'log') {
      console.log(logEntry);
    }
  });

  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log('=== Step 1: Navigate ===');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  console.log('=== Step 2: Enter password and connect ===');
  await page.fill('input[type="password"]', 'h264_final');

  const connectBtn = await page.$('button:has-text("Connect")');
  if (connectBtn) {
    await connectBtn.click();
    await page.waitForTimeout(4000);
  }

  console.log('=== Step 3: Click VNC button ===');
  const vncBtn = await page.$('button:has-text("VNC")');
  if (vncBtn) {
    try {
      await vncBtn.click();
      await page.waitForTimeout(5000);
    } catch (err) {
      console.log('Error clicking VNC:', err.message);
    }
  }

  console.log('=== Step 4: Check video status ===');
  const videoStatus = await page.evaluate(() => {
    const video = document.getElementById('h264-video');
    const sourceBuffer = window._h264_decoder_vnc?.sourceBuffer;
    return {
      video_src: video?.src || 'none',
      video_ready_state: video?.readyState || 'none',
      video_network_state: video?.networkState || 'none',
      source_buffer_exist: !!sourceBuffer,
      source_buffer_updating: sourceBuffer?.updating || 'unknown'
    };
  });
  console.log('Video status:', JSON.stringify(videoStatus));

  console.log('=== Step 5: Get console logs ===');
  console.log(`Total console logs: ${consoleLogs.length}`);
  consoleLogs.filter(l => l.includes('H.264') || l.includes('error') || l.includes('Error')).forEach(log => {
    console.log(log);
  });

  await page.screenshot({ path: '/tmp/h264_debug.png', fullPage: true });
  console.log('Screenshot saved!');

  await browser.close();
})();
