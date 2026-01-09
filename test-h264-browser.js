import { chromium } from 'playwright';

/**
 * H.264 Video Stream Browser Test
 * Tests the H.264 streaming pipeline end-to-end
 */

const SERVER_URL = 'https://shelly.247420.xyz';
const TEST_PASSWORD = 'test_h264_1767990520';  // Using currently running CLI provider

console.log('H.264 Stream Browser Test');
console.log('=========================');
console.log(`Server: ${SERVER_URL}`);
console.log(`Password: ${TEST_PASSWORD}`);
console.log('');

async function main() {
  let browser;
  try {
    // Launch browser
    console.log('Launching browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();

    // Capture all console messages
    const logs = [];
    page.on('console', msg => {
      const entry = {
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString()
      };
      logs.push(entry);
      if (msg.type() !== 'log') {
        console.log(`  [${msg.type()}] ${msg.text()}`);
      }
    });

    // Navigate to the app
    console.log('[Step 1] Navigating to web app...');
    await page.goto(SERVER_URL, { waitUntil: 'networkidle' });
    console.log('✓ Page loaded');

    // Enter password
    console.log('[Step 2] Entering password and connecting to session...');
    await page.fill('input[id="password-input"]', TEST_PASSWORD);
    await page.click('button[id="password-submit"]');

    // Wait for session tab to appear
    console.log('  Waiting for session tab to appear...');
    await page.waitForSelector('.tab-button', { timeout: 10000 });
    const tab_count = await page.locator('.tab-button').count();
    console.log(`✓ Found ${tab_count} session(s)`);

    // Click the first tab
    console.log('[Step 3] Clicking session tab to connect...');
    const tab = page.locator('.tab-button').first();
    await tab.click();
    await page.waitForTimeout(1000);

    // Check terminal connection
    const session_status = await page.evaluate(() => {
      const sessions = window.sessions || new Map();
      const active_id = window.active_session_id;
      if (active_id && sessions.has(active_id)) {
        const sess = sessions.get(active_id);
        return {
          connected: sess.is_connected,
          has_ws: !!sess.ws,
          ws_ready: sess.ws ? sess.ws.readyState === 1 : false
        };
      }
      return null;
    });

    if (session_status) {
      console.log(`✓ Session connected: ${session_status.connected}`);
      console.log(`  WebSocket ready: ${session_status.ws_ready}`);
    }

    // Click VNC button to open H.264 stream
    console.log('[Step 4] Opening VNC modal to display H.264 video...');
    const vnc_btn = page.locator('button:has-text("VNC")');
    const vnc_visible = await vnc_btn.isVisible().catch(() => false);

    if (!vnc_visible) {
      console.log('✗ VNC button not visible');
    } else {
      await vnc_btn.click();
      console.log('  VNC button clicked');

      // Wait for modal to open
      await page.waitForTimeout(1000);

      // Check if modal opened and video element exists
      const modal = await page.locator('#vnc-modal.active');
      const modal_visible = await modal.isVisible().catch(() => false);

      if (modal_visible) {
        console.log('✓ VNC modal opened');

        const video = await page.locator('#h264-video');
        const video_exists = await video.isVisible().catch(() => false);

        if (video_exists) {
          console.log('✓ Video element exists and is visible');

          // Wait for video to start receiving data
          await page.waitForTimeout(3000);

          // Check video status
          const video_status = await page.evaluate(() => {
            const v = document.getElementById('h264-video');
            if (!v) return { error: 'video element not found' };

            const buffered = [];
            for (let i = 0; i < v.buffered.length; i++) {
              buffered.push({
                start: v.buffered.start(i),
                end: v.buffered.end(i)
              });
            }

            return {
              paused: v.paused,
              ended: v.ended,
              currentTime: v.currentTime,
              duration: v.duration,
              readyState: v.readyState,
              networkState: v.networkState,
              buffered: buffered,
              error: v.error ? v.error.message : null,
              bufferedBytes: buffered.reduce((sum, b) => sum + (b.end - b.start), 0)
            };
          });

          console.log('[Step 5] Video status:');
          console.log(`  Paused: ${video_status.paused}`);
          console.log(`  Current Time: ${video_status.currentTime.toFixed(2)}s`);
          console.log(`  Duration: ${video_status.duration}s`);
          console.log(`  Ready State: ${video_status.readyState} (4=HAVE_ENOUGH_DATA)`);
          console.log(`  Network State: ${video_status.networkState} (2=NETWORK_LOADING)`);
          console.log(`  Buffered Ranges: ${video_status.buffered.length}`);
          if (video_status.buffered.length > 0) {
            console.log(`    Total buffered: ${video_status.bufferedBytes.toFixed(2)}s`);
          }
          if (video_status.error) {
            console.log(`  Error: ${video_status.error}`);
          }

          // Check H.264 WebSocket status
          console.log('[Step 6] H.264 WebSocket status:');
          const h264_status = await page.evaluate(() => {
            const ws = window.h264_video_ws;
            if (!ws) {
              return { exists: false, message: 'WebSocket not initialized' };
            }

            const state_names = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
            return {
              exists: true,
              readyState: ws.readyState,
              state_name: state_names[ws.readyState],
              url: ws.url,
              bufferedAmount: ws.bufferedAmount
            };
          });

          if (h264_status.exists) {
            console.log(`✓ H.264 WebSocket: ${h264_status.state_name}`);
            console.log(`  URL: ${h264_status.url}`);
            console.log(`  Buffered: ${h264_status.bufferedAmount} bytes`);
          } else {
            console.log(`✗ ${h264_status.message}`);
          }

          // Check decoder status
          console.log('[Step 7] H.264 decoder status:');
          const decoder = await page.evaluate(() => {
            const dec = window.h264_decoder;
            if (!dec) {
              return { initialized: false };
            }

            const buffered_ranges = [];
            if (dec.sourceBuffer && dec.sourceBuffer.buffered) {
              for (let i = 0; i < dec.sourceBuffer.buffered.length; i++) {
                buffered_ranges.push({
                  start: dec.sourceBuffer.buffered.start(i),
                  end: dec.sourceBuffer.buffered.end(i)
                });
              }
            }

            return {
              initialized: true,
              has_source_buffer: !!dec.sourceBuffer,
              updating: dec.sourceBuffer ? dec.sourceBuffer.updating : null,
              buffered_ranges: buffered_ranges,
              mediaSource_readyState: dec.mediaSource ? dec.mediaSource.readyState : null
            };
          });

          if (decoder.initialized) {
            console.log('✓ H.264 decoder initialized');
            console.log(`  SourceBuffer exists: ${decoder.has_source_buffer}`);
            console.log(`  SourceBuffer updating: ${decoder.updating}`);
            console.log(`  Buffered ranges: ${decoder.buffered_ranges.length}`);
            if (decoder.buffered_ranges.length > 0) {
              const total_buffered = decoder.buffered_ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
              console.log(`    Total: ${total_buffered.toFixed(2)}s`);
            }
          } else {
            console.log('✗ H.264 decoder not initialized');
          }
        } else {
          console.log('✗ Video element not visible');
        }
      } else {
        console.log('✗ VNC modal did not open');
      }
    }

    // Summary
    console.log('');
    console.log('[Summary] Browser test results:');
    const h264_logs = logs.filter(l => l.text.includes('H.264') || l.text.includes('Stream'));
    console.log(`  H.264 console messages: ${h264_logs.length}`);
    if (h264_logs.length > 0) {
      console.log('  Sample messages:');
      h264_logs.slice(0, 3).forEach(l => {
        console.log(`    [${l.type}] ${l.text.substring(0, 80)}`);
      });
    }

    // Take screenshot
    console.log('');
    console.log('[Step 8] Taking screenshot...');
    await page.screenshot({ path: '/home/user/webshell/h264-stream-test.png', fullPage: true });
    console.log('✓ Screenshot saved: h264-stream-test.png');

    console.log('');
    console.log('Test Complete!');
  } catch (err) {
    console.error('Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
