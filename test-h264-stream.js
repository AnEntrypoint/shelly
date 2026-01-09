import { chromium } from 'playwright';
import { WebSocket } from 'ws';

/**
 * Comprehensive H.264 Video Stream Test
 *
 * Tests:
 * 1. Session creation with /api/session endpoint
 * 2. WebSocket connection for H.264 stream
 * 3. VNC modal opens and displays video element
 * 4. H.264 chunks received and appended to MediaSource
 * 5. Video playback status and error reporting
 */

const SERVER_URL = 'https://shelly.247420.xyz';
const TEST_PASSWORD = `test_h264_${Date.now()}`;

console.log('H.264 Stream Test Suite');
console.log('=======================');
console.log(`Server: ${SERVER_URL}`);
console.log(`Test Password: ${TEST_PASSWORD}`);
console.log('');

// Step 1: Create a session via API
async function create_test_session() {
  console.log('[1] Creating test session via API...');
  const res = await fetch(`${SERVER_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: TEST_PASSWORD })
  });

  if (!res.ok) {
    throw new Error(`Session creation failed: ${res.status}`);
  }

  const session = await res.json();
  console.log(`✓ Session created: ${session.session_id.substring(0, 8)}...`);
  console.log(`  Token length: ${session.token.length}`);
  return session;
}

// Step 2: Check if CLI provider is connected
async function check_cli_provider() {
  console.log('[2] Checking if CLI provider is connected...');

  try {
    const res = await fetch(`${SERVER_URL}/api/sessions/by-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });

    if (!res.ok) {
      throw new Error(`Status ${res.status}`);
    }

    const data = await res.json();
    const sessions_with_provider = data.sessions ? data.sessions.filter(s => s.has_active_provider) : [];

    console.log(`✓ Sessions query returned: ${data.sessions?.length || 0} sessions`);
    console.log(`✓ Sessions with active provider: ${sessions_with_provider.length}`);

    if (sessions_with_provider.length === 0) {
      console.log('ℹ  No CLI provider connected yet');
      console.log(`   Command to start provider: node /home/user/shellyclient/index.js new ${SERVER_URL} ${TEST_PASSWORD}`);
      return false;
    }

    return true;
  } catch (err) {
    console.log(`ℹ  Could not verify provider status: ${err.message}`);
    return false;
  }
}

// Step 3: Open browser and navigate to app
async function test_browser_interface() {
  console.log('[3] Testing browser interface...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.createContext();
  const page = await context.newPage();

  // Set up console logging
  const console_logs = [];
  page.on('console', msg => {
    const log_entry = {
      type: msg.type(),
      text: msg.text(),
      timestamp: new Date().toISOString()
    };
    console_logs.push(log_entry);
    if (msg.type() !== 'log') {
      console.log(`  [${msg.type()}] ${msg.text()}`);
    }
  });

  try {
    // Navigate to app
    console.log(`  → Navigating to ${SERVER_URL}`);
    await page.goto(SERVER_URL, { waitUntil: 'networkidle' });
    console.log('  ✓ Page loaded');

    // Wait for password input
    console.log(`  → Waiting for password input...`);
    await page.waitForSelector('input[id="password"]', { timeout: 5000 });
    console.log('  ✓ Password input found');

    // Enter password
    console.log(`  → Entering password: ${TEST_PASSWORD}`);
    await page.fill('input[id="password"]', TEST_PASSWORD);

    // Submit password
    console.log('  → Submitting password...');
    await page.click('button[id="submit-password"]');

    // Wait for session tabs to appear
    console.log('  → Waiting for session tabs...');
    await page.waitForSelector('.tab-button', { timeout: 10000 });
    const tab_count = await page.locator('.tab-button').count();
    console.log(`  ✓ Found ${tab_count} session tab(s)`);

    // Click first tab to activate session
    console.log('  → Clicking first session tab...');
    await page.click('.tab-button');
    await page.waitForTimeout(500);

    // Check if terminal is connected
    console.log('  → Checking terminal connection status...');
    const terminal = await page.locator('#terminal');
    const is_visible = await terminal.isVisible();
    console.log(`  ${is_visible ? '✓' : '✗'} Terminal visible: ${is_visible}`);

    // Look for Connect button
    const connect_btn = await page.locator('button:has-text("Connect")');
    const connect_visible = await connect_btn.isVisible().catch(() => false);
    if (connect_visible) {
      console.log('  → Clicking Connect button...');
      await connect_btn.click();
      await page.waitForTimeout(1000);
    }

    // Check WebSocket connection
    console.log('  → Checking WebSocket connection...');
    const ws_status = await page.evaluate(() => {
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
      return { connected: false, has_ws: false, ws_ready: false };
    });
    console.log(`  ${ws_status.connected ? '✓' : '✗'} WebSocket connected: ${ws_status.connected}`);

    // Test 1: Click VNC button to open H.264 modal
    console.log('[4] Testing VNC modal and H.264 stream...');
    const vnc_btn = await page.locator('button:has-text("VNC")');
    const vnc_visible = await vnc_btn.isVisible().catch(() => false);

    if (!vnc_visible) {
      console.log('  ✗ VNC button not found or not visible');
    } else {
      console.log('  → Clicking VNC button...');
      await vnc_btn.click();
      await page.waitForTimeout(1000);

      // Check if modal opened
      const modal = await page.locator('#vnc-modal.active');
      const modal_visible = await modal.isVisible().catch(() => false);
      console.log(`  ${modal_visible ? '✓' : '✗'} VNC modal opened: ${modal_visible}`);

      if (modal_visible) {
        // Check for video element
        const video = await page.locator('#h264-video');
        const video_exists = await video.isVisible().catch(() => false);
        console.log(`  ${video_exists ? '✓' : '✗'} Video element exists: ${video_exists}`);

        if (video_exists) {
          // Get video element properties
          const video_props = await page.evaluate(() => {
            const v = document.getElementById('h264-video');
            if (!v) return null;
            return {
              paused: v.paused,
              ended: v.ended,
              currentTime: v.currentTime,
              duration: v.duration,
              readyState: v.readyState,
              networkState: v.networkState,
              error: v.error ? v.error.message : null
            };
          });
          console.log('  Video element status:');
          console.log(`    • Paused: ${video_props.paused}`);
          console.log(`    • Current Time: ${video_props.currentTime}s`);
          console.log(`    • Duration: ${video_props.duration}s`);
          console.log(`    • Ready State: ${video_props.readyState} (4=HAVE_ENOUGH_DATA)`);
          console.log(`    • Network State: ${video_props.networkState}`);
          if (video_props.error) {
            console.log(`    • Error: ${video_props.error}`);
          }
        }

        // Check H.264 stream WebSocket status
        console.log('  → Checking H.264 stream WebSocket...');
        await page.waitForTimeout(2000);

        const h264_ws_status = await page.evaluate(() => {
          const ws = window.h264_video_ws;
          if (!ws) return { exists: false, readyState: null, url: null };
          return {
            exists: true,
            readyState: ws.readyState,
            url: ws.url,
            state_name: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState]
          };
        });

        console.log(`  ${h264_ws_status.exists ? '✓' : '✗'} H.264 WebSocket: ${h264_ws_status.exists ? 'exists' : 'not created'}`);
        if (h264_ws_status.exists) {
          console.log(`    • State: ${h264_ws_status.state_name} (${h264_ws_status.readyState})`);
          console.log(`    • URL: ${h264_ws_status.url}`);
        }

        // Check decoder status
        console.log('  → Checking H.264 decoder status...');
        const decoder_status = await page.evaluate(() => {
          const decoder = window.h264_decoder;
          if (!decoder) return { initialized: false };
          return {
            initialized: true,
            has_source_buffer: !!decoder.sourceBuffer,
            updating: decoder.sourceBuffer ? decoder.sourceBuffer.updating : null,
            buffered_ranges: decoder.sourceBuffer ? decoder.sourceBuffer.buffered.length : 0
          };
        });
        console.log(`  ${decoder_status.initialized ? '✓' : '✗'} H.264 decoder initialized: ${decoder_status.initialized}`);
        if (decoder_status.initialized) {
          console.log(`    • SourceBuffer exists: ${decoder_status.has_source_buffer}`);
          console.log(`    • SourceBuffer updating: ${decoder_status.updating}`);
          console.log(`    • Buffered ranges: ${decoder_status.buffered_ranges}`);
        }
      }
    }

    // Test 2: Monitor console for H.264-related messages
    console.log('[5] Console logs analysis:');
    const h264_logs = console_logs.filter(l => l.text.includes('H.264') || l.text.includes('Stream'));
    if (h264_logs.length === 0) {
      console.log('  ℹ  No H.264 console logs captured');
    } else {
      console.log(`  Found ${h264_logs.length} H.264-related log messages:`);
      h264_logs.forEach(l => {
        console.log(`    [${l.type}] ${l.text}`);
      });
    }

    // Test 3: Monitor network activity
    console.log('[6] Network requests summary:');
    const requests = [];
    page.on('request', req => {
      if (req.url().includes('/api/') || req.url().includes('ws')) {
        requests.push({
          method: req.method(),
          url: req.url(),
          timestamp: new Date().toISOString()
        });
      }
    });

    await page.waitForTimeout(3000);
    const api_requests = requests.filter(r => r.url.includes('/api/'));
    console.log(`  API requests made: ${api_requests.length}`);

    // Final summary
    console.log('[7] Test Summary:');
    console.log(`✓ Browser interface working`);
    console.log(`✓ Session tabs created`);
    console.log(`${vnc_visible ? '✓' : '✗'} VNC button available`);
    console.log(`${modal_visible ? '✓' : '✗'} VNC modal opens`);
    console.log(`${video_exists ? '✓' : '✗'} Video element rendered`);
    console.log(`${h264_ws_status.exists ? '✓' : '✗'} H.264 WebSocket connected`);
    console.log(`${decoder_status.initialized ? '✓' : '✗'} H.264 decoder ready`);

    await page.screenshot({ path: '/home/user/webshell/h264-test-screenshot.png' });
    console.log('Screenshot saved to h264-test-screenshot.png');

  } catch (err) {
    console.error('Test error:', err.message);
    console.log('');
    console.log('Error details:');
    console.log(err.stack);
  } finally {
    await context.close();
    await browser.close();
  }
}

// Main
async function main() {
  try {
    console.log('========================================');
    console.log('H.264 Video Stream Integration Test');
    console.log('========================================');
    console.log('');

    const session = await create_test_session();
    const has_provider = await check_cli_provider();

    console.log('');
    if (!has_provider) {
      console.log('⚠️  No CLI provider connected. You need to start it manually.');
      console.log('');
      console.log('In another terminal, run:');
      console.log(`  cd /home/user/shellyclient`);
      console.log(`  DISPLAY=:99 node index.js new ${SERVER_URL} ${TEST_PASSWORD}`);
      console.log('');
      console.log('Then re-run this test.');
      process.exit(1);
    }

    console.log('✓ CLI provider is connected and ready to stream');
    console.log('');

    // Wait a moment for H.264 encoding to start
    console.log('Waiting 3 seconds for H.264 encoder to start...');
    await new Promise(r => setTimeout(r, 3000));

    await test_browser_interface();

    console.log('');
    console.log('========================================');
    console.log('Test Complete!');
    console.log('========================================');
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

main();
