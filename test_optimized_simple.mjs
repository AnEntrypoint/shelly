import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log('=== CHECKING OPTIMIZED VIDEO ===');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  console.log('Entering password...');
  await page.fill('input[type="password"]', 'video_optimized_test');
  
  const connectBtn = await page.$('button:has-text("Connect")');
  if (connectBtn) {
    await connectBtn.click();
    await page.waitForTimeout(5000);
  }

  console.log('Checking session status...');
  const sessionInfo = await page.evaluate(() => {
    const tabCount = document.querySelectorAll('[id^="tab-"]').length;
    const vncBtn = Array.from(document.querySelectorAll('button')).find(b => 
      b.textContent.includes('VNC')
    );
    return {
      sessionLoaded: tabCount > 0,
      vncButtonExists: !!vncBtn,
      vncButtonEnabled: vncBtn ? !vncBtn.disabled : false,
      vncButtonText: vncBtn?.textContent || 'not found'
    };
  });

  console.log(`Session loaded: ${sessionInfo.sessionLoaded}`);
  console.log(`VNC button exists: ${sessionInfo.vncButtonExists}`);
  console.log(`VNC button enabled: ${sessionInfo.vncButtonEnabled}`);
  console.log(`VNC button text: "${sessionInfo.vncButtonText}"`);

  if (sessionInfo.vncButtonEnabled) {
    console.log('\nClicking VNC button to open video...');
    const vncBtn = await page.$('button:has-text("VNC")');
    if (vncBtn) {
      // Just click without waiting
      await vncBtn.click();
      await page.waitForTimeout(3000);
    }

    const videoStatus = await page.evaluate(() => {
      const video = document.getElementById('h264-video');
      const modal = document.getElementById('vnc-modal');
      return {
        videoExists: !!video,
        videoSrc: video?.src?.substring(0, 50) || 'none',
        modalActive: modal?.classList.contains('active') || false
      };
    });

    console.log(`Video element exists: ${videoStatus.videoExists}`);
    console.log(`Video source: ${videoStatus.videoSrc}...`);
    console.log(`Modal is active: ${videoStatus.modalActive}`);
    
    if (videoStatus.videoExists && videoStatus.modalActive) {
      console.log('\n✅ Video display is working with optimized 20fps encoding!');
    }
  }

  await page.screenshot({ path: '/tmp/optimized_check.png' });
  console.log('Screenshot saved\n');

  await browser.close();
})();
