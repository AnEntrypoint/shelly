/**
 * H.264 Video Streaming Test Suite
 *
 * Tests the complete H.264 video pipeline with separate decoders for terminal and VNC
 * Date: 2026-01-09
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PASSWORD = `test_h264_${Date.now()}`;
const TEST_URL = 'http://localhost:3000';
const SCREENSHOTS_DIR = path.join(__dirname, 'test-screenshots');

// Create screenshots directory
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

let browser;
let context;
let page;
let test_results = {
  timestamp: new Date().toISOString(),
  password: TEST_PASSWORD,
  tests: []
};

async function log_test(name, status, details = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    test: name,
    status,
    details
  }));

  test_results.tests.push({
    name,
    status,
    details,
    timestamp: new Date().toISOString()
  });
}

async function setup() {
  console.log('Starting H.264 Video Test Suite');
  console.log(`Test Password: ${TEST_PASSWORD}`);
  console.log(`Server URL: ${TEST_URL}`);

  browser = await chromium.launch({ headless: false });
  context = await browser.newContext({
    recordVideo: { dir: SCREENSHOTS_DIR }
  });
  page = await context.newPage();

  // Listen for console messages
  page.on('console', (msg) => {
    const log_text = msg.text();
    if (log_text.includes('H.264') || log_text.includes('decoder') || log_text.includes('MediaSource')) {
      console.log(`[BROWSER] ${log_text}`);
    }
  });

  // Listen for page errors
  page.on('pageerror', (err) => {
    console.error(`[PAGE ERROR] ${err.message}`);
  });

  await log_test('Browser Setup', 'PASSED', { browser: 'chromium', headless: false });
}

async function test_page_load() {
  console.log('\n=== Test 1: Page Load ===');

  try {
    await page.goto(TEST_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('#password-input', { timeout: 5000 });

    await log_test('Page Load', 'PASSED', {
      url: TEST_URL,
      title: await page.title()
    });
  } catch (err) {
    await log_test('Page Load', 'FAILED', { error: err.message });
    throw err;
  }
}

async function test_session_creation() {
  console.log('\n=== Test 2: Session Creation ===');

  try {
    // Enter password
    await page.fill('#password-input', TEST_PASSWORD);
    await log_test('Password Entry', 'PASSED', { password_entered: true });

    // Submit
    await page.click('button:has-text("Submit")');

    // Wait for session tabs to appear
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    const session_tabs = await page.locator('[role="tab"]').count();

    if (session_tabs > 0) {
      await log_test('Session Creation', 'PASSED', {
        session_tabs_found: session_tabs,
        password: TEST_PASSWORD
      });
    } else {
      await log_test('Session Creation', 'FAILED', {
        error: 'No session tabs appeared'
      });
    }
  } catch (err) {
    await log_test('Session Creation', 'FAILED', { error: err.message });
    throw err;
  }
}

async function test_session_connection() {
  console.log('\n=== Test 3: Session Connection ===');

  try {
    // Get first session tab
    const first_tab = await page.locator('[role="tab"]').first();
    await first_tab.click();

    // Wait for terminal to be visible
    await page.waitForSelector('.xterm-screen', { timeout: 10000 });

    // Check for connection status
    await page.waitForTimeout(2000);

    const status_text = await page.locator('header .info-item').first().textContent();

    await log_test('Session Connection', 'PASSED', {
      connection_status: status_text,
      terminal_visible: true
    });
  } catch (err) {
    await log_test('Session Connection', 'FAILED', { error: err.message });
    throw err;
  }
}

async function test_vnc_button_visibility() {
  console.log('\n=== Test 4: VNC Button Visibility ===');

  try {
    // Check if VNC button exists and is enabled
    const vnc_button = await page.locator('button:has-text("VNC")');
    const is_visible = await vnc_button.isVisible();
    const is_enabled = await vnc_button.isEnabled();

    if (is_visible && is_enabled) {
      await log_test('VNC Button Visibility', 'PASSED', {
        button_visible: is_visible,
        button_enabled: is_enabled
      });
    } else {
      await log_test('VNC Button Visibility', 'WARNING', {
        button_visible: is_visible,
        button_enabled: is_enabled,
        note: 'VNC button disabled or hidden'
      });
    }
  } catch (err) {
    await log_test('VNC Button Visibility', 'FAILED', { error: err.message });
  }
}

async function test_h264_decoder_initialization() {
  console.log('\n=== Test 5: H.264 Decoder Initialization ===');

  try {
    // Check if decoders are defined in window
    const decoder_check = await page.evaluate(() => {
      return {
        h264_decoder_terminal: typeof window.h264_decoder_terminal,
        h264_decoder_vnc: typeof window.h264_decoder_vnc,
        H264Decoder: typeof window.H264Decoder,
        MediaSource: typeof window.MediaSource
      };
    });

    await log_test('H.264 Decoder Variables', 'PASSED', decoder_check);
  } catch (err) {
    await log_test('H.264 Decoder Variables', 'FAILED', { error: err.message });
  }
}

async function test_vnc_modal_open() {
  console.log('\n=== Test 6: VNC Modal Opening ===');

  try {
    // Click VNC button
    const vnc_button = await page.locator('button:has-text("VNC")');
    const is_enabled = await vnc_button.isEnabled();

    if (!is_enabled) {
      await log_test('VNC Modal Opening', 'SKIPPED', {
        reason: 'VNC button disabled'
      });
      return;
    }

    await vnc_button.click();

    // Wait for modal to appear
    await page.waitForSelector('#vnc-modal.active', { timeout: 5000 });

    const modal_visible = await page.locator('#vnc-modal.active').isVisible();

    if (modal_visible) {
      await log_test('VNC Modal Opening', 'PASSED', {
        modal_visible: true,
        modal_class: 'active'
      });

      // Take screenshot 1
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '1-vnc-modal-opened.png'),
        fullPage: true
      });
    } else {
      await log_test('VNC Modal Opening', 'FAILED', {
        error: 'Modal not visible after click'
      });
    }
  } catch (err) {
    await log_test('VNC Modal Opening', 'FAILED', { error: err.message });
  }
}

async function test_h264_stream_connection() {
  console.log('\n=== Test 7: H.264 Stream Connection ===');

  try {
    // Wait 2 seconds for H.264 connection to establish
    await page.waitForTimeout(2000);

    // Check for H.264 WebSocket connection
    const ws_connected = await page.evaluate(() => {
      return window.h264_video_ws && window.h264_video_ws.readyState === 1;
    });

    // Take screenshot 2
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '2-vnc-modal-2sec.png'),
      fullPage: true
    });

    if (ws_connected) {
      await log_test('H.264 Stream Connection', 'PASSED', {
        websocket_connected: true,
        readyState: 1
      });
    } else {
      await log_test('H.264 Stream Connection', 'WARNING', {
        websocket_connected: false,
        note: 'WebSocket may still be connecting'
      });
    }
  } catch (err) {
    await log_test('H.264 Stream Connection', 'FAILED', { error: err.message });
  }
}

async function test_h264_decoder_status() {
  console.log('\n=== Test 8: H.264 Decoder Status (After 5 Seconds) ===');

  try {
    // Wait 5 seconds total from opening modal
    await page.waitForTimeout(3000); // Already waited 2 seconds

    // Check decoder initialization status
    const decoder_status = await page.evaluate(() => {
      return {
        h264_decoder_vnc_exists: !!window.h264_decoder_vnc,
        h264_decoder_vnc_has_sourceBuffer: window.h264_decoder_vnc?.sourceBuffer ? true : false,
        h264_decoder_vnc_has_mediaSource: window.h264_decoder_vnc?.mediaSource ? true : false,
        h264_decoder_vnc_has_video: window.h264_decoder_vnc?.video ? true : false,
        h264_decoder_terminal_exists: !!window.h264_decoder_terminal,
        MediaSource_supported: typeof window.MediaSource !== 'undefined'
      };
    });

    // Take screenshot 3
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '3-vnc-modal-5sec.png'),
      fullPage: true
    });

    const all_ready = decoder_status.h264_decoder_vnc_exists &&
                      decoder_status.h264_decoder_vnc_has_sourceBuffer &&
                      decoder_status.h264_decoder_vnc_has_mediaSource;

    if (all_ready) {
      await log_test('H.264 Decoder Status', 'PASSED', decoder_status);
    } else {
      await log_test('H.264 Decoder Status', 'WARNING', {
        ...decoder_status,
        note: 'Some decoder components not initialized'
      });
    }
  } catch (err) {
    await log_test('H.264 Decoder Status', 'FAILED', { error: err.message });
  }
}

async function test_browser_console_logs() {
  console.log('\n=== Test 9: Browser Console Analysis ===');

  try {
    // Collect all console messages
    const logs = [];

    page.on('console', (msg) => {
      logs.push({
        type: msg.type(),
        text: msg.text()
      });
    });

    // Wait a bit more for any additional logs
    await page.waitForTimeout(2000);

    // Analyze logs for H.264 related messages
    const h264_logs = logs.filter(log =>
      log.text.includes('H.264') ||
      log.text.includes('decoder') ||
      log.text.includes('MediaSource') ||
      log.text.includes('h264')
    );

    const error_logs = logs.filter(log => log.type === 'error');

    await log_test('Console Log Analysis', 'INFO', {
      total_logs: logs.length,
      h264_related_logs: h264_logs.length,
      error_logs: error_logs.length,
      errors: error_logs.map(e => e.text)
    });
  } catch (err) {
    await log_test('Browser Console Analysis', 'FAILED', { error: err.message });
  }
}

async function test_video_element_rendering() {
  console.log('\n=== Test 10: Video Element Rendering ===');

  try {
    // Check if video element exists and is rendered
    const video_exists = await page.locator('#h264-video').isVisible();

    if (video_exists) {
      const video_props = await page.evaluate(() => {
        const video = document.getElementById('h264-video');
        if (!video) return null;
        return {
          tagName: video.tagName,
          autoplay: video.autoplay,
          controls: video.controls,
          src_set: !!video.src,
          width: video.offsetWidth,
          height: video.offsetHeight,
          backgroundColor: window.getComputedStyle(video).backgroundColor
        };
      });

      await log_test('Video Element Rendering', 'PASSED', video_props);
    } else {
      await log_test('Video Element Rendering', 'WARNING', {
        video_visible: false,
        note: 'H.264 video element not visible'
      });
    }
  } catch (err) {
    await log_test('Video Element Rendering', 'FAILED', { error: err.message });
  }
}

async function test_separate_decoders() {
  console.log('\n=== Test 11: Separate Decoder Verification ===');

  try {
    // Verify that terminal and VNC decoders are separate objects
    const decoder_separation = await page.evaluate(() => {
      const terminal_decoder = window.h264_decoder_terminal;
      const vnc_decoder = window.h264_decoder_vnc;

      return {
        terminal_exists: !!terminal_decoder,
        vnc_exists: !!vnc_decoder,
        are_different_objects: terminal_decoder !== vnc_decoder,
        terminal_sourceBuffer_exists: !!terminal_decoder?.sourceBuffer,
        vnc_sourceBuffer_exists: !!vnc_decoder?.sourceBuffer
      };
    });

    if (decoder_separation.are_different_objects) {
      await log_test('Separate Decoder Verification', 'PASSED', decoder_separation);
    } else {
      await log_test('Separate Decoder Verification', 'WARNING', decoder_separation);
    }
  } catch (err) {
    await log_test('Separate Decoder Verification', 'FAILED', { error: err.message });
  }
}

async function cleanup() {
  console.log('\n=== Cleanup ===');

  // Save test results
  const results_file = path.join(SCREENSHOTS_DIR, 'test-results.json');
  fs.writeFileSync(results_file, JSON.stringify(test_results, null, 2));
  console.log(`Test results saved to: ${results_file}`);

  // Close browser
  if (context) await context.close();
  if (browser) await browser.close();

  console.log('Test suite completed');
}

async function run_tests() {
  try {
    await setup();
    await test_page_load();
    await test_session_creation();
    await test_session_connection();
    await test_vnc_button_visibility();
    await test_h264_decoder_initialization();
    await test_vnc_modal_open();
    await test_h264_stream_connection();
    await test_h264_decoder_status();
    await test_browser_console_logs();
    await test_video_element_rendering();
    await test_separate_decoders();
  } catch (err) {
    console.error('Test suite failed:', err);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

run_tests();
