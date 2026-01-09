import { chromium } from 'playwright';

const password = 'test_h264_final_1767991127';
const serverUrl = 'https://shelly.247420.xyz';

(async () => {
  console.log(`Starting H.264 video stream test with password: ${password}`);
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    // Navigate to the server
    console.log(`Navigating to ${serverUrl}...`);
    await page.goto(serverUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait for password input
    console.log('Waiting for password input...');
    const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => null);
    
    if (!passwordInput) {
      console.error('Password input not found');
      await page.screenshot({ path: '/tmp/h264_screenshot_1_error.jpg', fullPage: true });
      throw new Error('Password input not found');
    }
    
    // Enter password
    console.log(`Entering password: ${password}`);
    await passwordInput.fill(password);
    
    // Submit form
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
    
    // Wait for sessions to load
    console.log('Waiting for sessions to load...');
    await page.waitForTimeout(3000);
    
    // Look for VNC button
    console.log('Looking for VNC button...');
    const vncBtn = await page.$('button:has-text("VNC")');
    
    if (vncBtn) {
      console.log('Found VNC button, clicking...');
      await vncBtn.click();
      await page.waitForTimeout(3000);
    }
    
    // Take first screenshot
    console.log('Taking screenshot 1...');
    await page.screenshot({ path: '/tmp/h264_screenshot_1.jpg', fullPage: false });
    
    // Wait and take second screenshot
    console.log('Waiting 2 seconds...');
    await page.waitForTimeout(2000);
    
    console.log('Taking screenshot 2...');
    await page.screenshot({ path: '/tmp/h264_screenshot_2.jpg', fullPage: false });
    
    console.log('Screenshots saved successfully');
    
  } catch (err) {
    console.error('Test error:', err.message);
  } finally {
    await browser.close();
    process.exit(0);
  }
})();
