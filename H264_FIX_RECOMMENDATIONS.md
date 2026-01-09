# H.264 Video Streaming - Immediate Action Items

## Critical Issue
FFmpeg process terminates with exit code 234 within 61ms of being spawned by the server. No H.264 frames are ever generated or sent to clients.

**Timeline of Failure**:
```
T+0ms:    FFmpeg spawned successfully (PID created)
T+55ms:   First stderr output received
T+61ms:   Process exits with code 234 (BEFORE callback attached)
T+15000ms: WebSocket times out waiting for frames
```

---

## Immediate Debugging Steps

### Step 1: Capture Full FFmpeg Error Message
**File**: `/home/user/webshell/src/server/vnc-encoder.js` (lines 111-116)

**Current code**:
```javascript
this.ffmpeg_process.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg && !msg.includes('frame=')) {
    this.log_state('ffmpeg_stderr', null, msg.substring(0, 100), 'encoder_debug');
  }
});
```

**Problem**: Filters out frame= progress lines but may be truncating actual error messages to 100 chars.

**Recommended change**:
```javascript
this.ffmpeg_process.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  // Log ALL output, not just non-frame lines, and don't truncate
  if (msg) {
    this.log_state('ffmpeg_stderr_full', null, msg, 'encoder_debug');
  }
});
```

### Step 2: Detect FFmpeg Failures Early
**File**: `/home/user/webshell/src/server/vnc-encoder.js` (add after line 60)

**Add timeout detection**:
```javascript
// If FFmpeg hasn't produced ANY data within 5 seconds, it has likely failed
const output_timeout = setTimeout(() => {
  if (!this.is_encoding || !this.ffmpeg_process) return;

  this.log_state('ffmpeg_no_output_timeout', null, 'no data in 5 seconds', 'encoder_timeout');
  this.ffmpeg_process.kill('SIGTERM');
}, 5000);

// Clear timeout when first data arrives
this.ffmpeg_process.stdout.once('data', () => {
  clearTimeout(output_timeout);
});
```

### Step 3: Check Display Server Access
**Command to verify**:
```bash
# In server process context:
DISPLAY=:99 xdpyinfo 2>&1
DISPLAY=:99 ffmpeg -f x11grab -i :99.0 -frames:v 1 -f rawvideo - 2>&1 | head
```

**What to check**:
- Does xdpyinfo connect to :99?
- Can FFmpeg read from :99.0?
- What error messages appear?

### Step 4: Review FFmpeg Command Arguments
**File**: `/home/user/webshell/src/server/vnc-encoder.js` (line 22-34)

**Potential issues**:
```javascript
// Current: Requests specific video size upfront
'-video_size', `${width}x${height}`,  // 1024x768

// Problem: Xvfb screen is 1920x1080, so this mismatch may cause x11grab to fail

// Fix option 1: Match Xvfb resolution
// (Get from: Xvfb :99 -screen 0 1920x1080x24)

// Fix option 2: Let FFmpeg detect resolution
// Remove -video_size and let x11grab auto-detect

// Fix option 3: Crop/scale to requested resolution
// Add -vf "scale=1024:768" after encoding instead of before capture
```

### Step 5: Add Signal Handler Logging
**File**: `/home/user/webshell/src/server/vnc-encoder.js` (add after line 46)

**Add signal tracking**:
```javascript
this.ffmpeg_process.on('error', (err) => {
  this.log_state('ffmpeg_spawn_error', null, err.message, 'encoder_error');
});

// Detect if killed externally
process.on('SIGCHLD', () => {
  // Node.js automatically reaps child processes, but we can log if unexpected
});
```

---

## Recommended Fix Order

### Priority 1: Enable Detailed Logging (Quick Win)
1. Modify stderr handler to log full output (remove truncation)
2. Add "no output within 5 seconds" timeout detection
3. Deploy and test to see actual FFmpeg error message

**Time**: 10 minutes
**Risk**: None (logging only)
**Expected result**: Actual error message reveals real problem

### Priority 2: Verify Display Access
1. SSH into server
2. Run diagnostic commands above
3. Confirm x11grab can capture display
4. Check Xvfb resolution vs requested video size

**Time**: 15 minutes
**Risk**: None (read-only diagnostics)

### Priority 3: Fix Resolution Mismatch (Likely Culprit)
If diagnostics show resolution mismatch:
```javascript
// Instead of requesting 1024x768 on 1920x1080 display:
// Option A: Use matching resolution
const ffmpeg_args = [
  '-f', 'x11grab',
  '-framerate', framerate.toString(),
  // Don't specify video_size, let x11grab auto-detect
  '-i', `${display}.0`,
  // Then scale output to desired size
  '-vf', `scale=${width}:${height}`,
  ...rest_of_args
];

// Option B: Match Xvfb resolution instead
const ffmpeg_args = [
  '-f', 'x11grab',
  '-framerate', framerate.toString(),
  '-video_size', '1920x1080',  // Match Xvfb
  '-i', `${display}.0`,
  '-vf', `scale=${width}:${height}`,  // Then scale to requested
  ...rest_of_args
];
```

### Priority 4: Add Fallback Capture Method
If x11grab fails consistently, implement fallback:
```javascript
// Try x11grab first, then fallback to screencap/import
const capture_methods = [
  { method: 'x11grab', args: [...] },
  { method: 'gdigrab', args: [...] },  // Windows
  { method: 'avfoundation', args: [...] }  // macOS
];
```

---

## Testing the Fix

### Manual Test After Changes
```bash
# 1. Start server
npm start

# 2. Create session
curl -X POST http://localhost:3000/api/session \
  -H "Content-Type: application/json" \
  -d '{"password": "test_h264_fix"}'

# 3. Connect WebSocket and capture output
node test-h264.js <session_id> <token>

# 4. Check logs for actual FFmpeg error
tail -50 /tmp/server.log | grep -E "ffmpeg|stderr"

# 5. Verify frames are received
grep -c "h264_chunk_ready_to_send" /tmp/server.log
```

### Expected Success Indicators
- ✅ `ffmpeg_stderr` lines show normal x11grab initialization
- ✅ `encoder_callback_attached` appears in logs
- ✅ `ffmpeg_first_chunk_received` appears within 2 seconds
- ✅ `h264_chunk_ready_to_send` repeats every 0.5-1 second
- ✅ Client receives 2-10 H.264 frames before closing

---

## Implementation Checklist

- [ ] Enable full FFmpeg stderr logging
- [ ] Add 5-second no-output timeout
- [ ] Run display diagnostics on production server
- [ ] Identify actual FFmpeg error message
- [ ] Fix resolution mismatch (if that's the issue)
- [ ] Redeploy and test with WebSocket client
- [ ] Verify H.264 frames now stream to browser
- [ ] Test with browser's MediaSource API decoder
- [ ] Measure frame latency and quality
- [ ] Document final working configuration
- [ ] Remove debug logging after verification

---

## References

- FFmpeg x11grab documentation: https://ffmpeg.org/ffmpeg-devices.html#x11grab
- Exit code 234: Usually means process terminated (SIGTERM/SIGKILL)
- Xvfb configuration: `Xvfb :99 -screen 0 1920x1080x24`
- Server logs: `/tmp/server.log`

---

**Next Step**: Implement Priority 1 logging changes and redeploy to see actual FFmpeg error message. That error will reveal the exact cause of the failure.
