import { chromium } from 'playwright';

const password = 'test_h264_final_1767991127';
const serverUrl = 'https://shelly.247420.xyz';

(async () => {
  console.log(`Testing H.264 video stream with console monitoring`);
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Capture console messages
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      args: msg.args().length
    });
    console.log(`[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  try {
    console.log(`Navigating to ${serverUrl}...`);
    await page.goto(serverUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => null);
    
    if (!passwordInput) {
      throw new Error('Password input not found');
    }
    
    console.log(`Entering password: ${password}`);
    await passwordInput.fill(password);
    
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
    
    console.log('Waiting for sessions to load...');
    await page.waitForTimeout(3000);
    
    console.log('Looking for VNC button...');
    const vncBtn = await page.$('button:has-text("VNC")');
    
    if (vncBtn) {
      console.log('Clicking VNC button...');
      await vncBtn.click();
      
      // Wait for H.264 stream to initialize
      console.log('Waiting 5 seconds for H.264 stream initialization...');
      await page.waitForTimeout(5000);
      
      // Check for video element
      const videoExists = await page.evaluate(() => {
        const video = document.querySelector('video#h264-video');
        return {
          exists: !!video,
          src: video?.src || null,
          currentTime: video?.currentTime || null,
          readyState: video?.readyState || null,
          networkState: video?.networkState || null,
          duration: video?.duration || null
        };
      });
      console.log('Video element state:', JSON.stringify(videoExists, null, 2));
      
      // Check MediaSource
      const mediaSourceState = await page.evaluate(() => {
        try {
          return {
            isTypeSupported: MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'),
            typeSupported2: MediaSource.isTypeSupported('video/mp4; codecs="avc1"')
          };
        } catch (e) {
          return { error: e.message };
        }
      });
      console.log('MediaSource state:', JSON.stringify(mediaSourceState, null, 2));
    }
    
    console.log('\nConsole logs captured:');
    consoleLogs.forEach(log => {
      console.log(`  [${log.type}] ${log.text}`);
    });
    
  } catch (err) {
    console.error('Test error:', err.message);
  } finally {
    await browser.close();
    process.exit(0);
  }
})();
