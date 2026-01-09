# H.264 Video Streaming - Manual Test Guide

**Date**: 2026-01-09
**Objective**: Verify H.264 video streaming with separate decoders for terminal and VNC

## Test Setup

### Prerequisites
- Local server running on http://localhost:3000
- Browser with modern developer tools (Chrome/Firefox)
- X11 display available (Xvfb :99 recommended for WSL2)

### Key Fix Applied
Commit: `28e1f2a` - Separate terminal and VNC H.264 decoders to prevent MediaSource API conflict

**Critical Change**: Two separate decoder objects:
- `h264_decoder_terminal` - For terminal H.264 display (if implemented)
- `h264_decoder_vnc` - For VNC H.264 video modal

---

## Test Execution Steps

### Step 1: Page Load (Expected Time: 2 seconds)

1. Open browser to `http://localhost:3000`
2. Verify page loads with:
   - Dark VS Code theme visible
   - Password input field present
   - "Submit" button visible

**Success Criteria**: Page fully rendered, no 404 errors in console

---

### Step 2: Session Creation (Expected Time: 5 seconds)

1. Enter a test password: `test_h264_video_1`
2. Click "Submit"
3. Wait for session tabs to appear

**Success Criteria**:
- At least one session tab appears below password input
- Tab shows session ID (8 character identifier)

---

### Step 3: Session Connection (Expected Time: 3 seconds)

1. Click on the first session tab
2. Wait for terminal to initialize
3. Observe connection status indicator

**Success Criteria**:
- Green "Connected" indicator appears
- Terminal display visible (black area with xterm styling)
- No "Disconnected" messages

---

### Step 4: VNC Button Check (No Wait)

1. Look at the header buttons
2. Find the "VNC" button

**Success Criteria**:
- VNC button visible and enabled (blue color, not grayed out)
- Button is clickable

---

### Step 5: VNC Modal Opening (Expected Time: 1 second)

**SCREENSHOT 1: Take immediately after clicking VNC button**

1. Click the "VNC" button
2. Observe modal appears as overlay
3. Take first screenshot showing initial state

**Success Criteria**:
- Modal appears over terminal
- Modal title shows "H.264 Video Stream" or similar
- Modal has visible close button

---

### Step 6: Initial H.264 Connection (Expected Time: 2 seconds)

**Wait 2 seconds from modal opening**

1. Observe WebSocket connection in Network tab (F12 → Network → WS)
2. Check for `h264_stream_opened` or similar messages in console

**SCREENSHOT 2: Take after 2 seconds**

**Success Criteria** (in browser console):
```json
{
  "causation": "h264_stream_opened",
  "details": {
    "url": "wss://localhost:3000/api/vnc-video?session_id=..."
  }
}
```

---

### Step 7: H.264 Decoder Initialization (Expected Time: 3-5 seconds)

**Wait total 5 seconds from modal opening**

1. Open browser console (F12)
2. Check for decoder initialization logs:

**Look for these messages**:
```
H.264 Video: Native MediaSource initialized with fragmented MP4
H.264 Video: Using standard AVC1 codec
```

**SCREENSHOT 3: Take after 5 seconds total**

3. In console, run this command to verify decoder objects:
```javascript
console.log({
  h264_decoder_terminal: typeof window.h264_decoder_terminal,
  h264_decoder_vnc: typeof window.h264_decoder_vnc,
  are_different: window.h264_decoder_terminal !== window.h264_decoder_vnc,
  vnc_sourceBuffer: window.h264_decoder_vnc?.sourceBuffer ? 'exists' : 'missing',
  vnc_mediaSource: window.h264_decoder_vnc?.mediaSource ? 'exists' : 'missing'
});
```

**Success Criteria**:
- `h264_decoder_vnc` type is `object`
- `h264_decoder_terminal` type is `undefined` or `object` (separate if both defined)
- `are_different` is `true` (if terminal decoder exists)
- Both `sourceBuffer` and `mediaSource` exist for VNC decoder

---

## Console Log Checklist

Open browser console (F12 → Console tab) and verify these logs appear:

### Expected Log Sequence

1. **H.264 Stream: WebSocket connected**
   - Indicates `/api/vnc-video` WebSocket opened successfully

2. **H.264 Stream: Ready message received**
   - Server sent video dimensions and FPS
   - Example: `{width: 1024, height: 768, fps: 5}`

3. **H.264 Video: MediaSource initialized**
   - Native browser decoder created
   - MIME type: `video/mp4; codecs="avc1.42E01E"` or `avc1`

4. **H.264 Stream: Appended [N] bytes**
   - Video chunks received and appended to SourceBuffer
   - Example: `Appended 1024 bytes` (repeated every ~200ms)

5. **No InvalidStateError or append failures**
   - Critical: If SourceBuffer.updating is true, chunks are queued and retried
   - Check: `if (h264_decoder_vnc.sourceBuffer.updating === false)` prevents this

### Error Logs to Avoid

These indicate problems:

1. **H.264 Stream: Message processing error**
   - msgpackr decompression failed
   - Verify Packr() is initialized correctly

2. **H.264 Stream: Failed to append chunk**
   - SourceBuffer.appendBuffer() threw error
   - Common cause: SourceBuffer still updating (timing issue)
   - Our fix: Added `updating === false` check

3. **H.264 decoder not loaded**
   - CDN unavailable (no longer critical - using native MediaSource API)

4. **Received frame but decoder not initialized**
   - VNC chunks arrived before MediaSource ready
   - Should auto-retry when decoder ready

---

## Video Display Verification

### Expected Behavior

1. **Modal Background**: Black area fills modal space
2. **Video Content**: Should show X11 display capture (from Xvfb :99 or DISPLAY env var)
3. **Updates**: Video should refresh approximately every 200ms (5 FPS)
4. **No Flickering**: Smooth playback without visible frame drops

### Testing Video Content

If display :99 is running with content:

1. The video modal should show the captured display
2. Moving mouse or typing should not appear (unless captured by X11)
3. Window manager (if any) should be visible

If display :99 is blank:

- Video will show black rectangle (expected)
- Decoder is still working correctly

---

## Server-Side Verification

In server logs, look for H.264-related entries:

```
{
  "causation": "h264_stream_started",
  "next": "1024x768@5fps"
}

{
  "causation": "h264_chunk_ready_to_send",
  "next": "1024_bytes"
}

{
  "causation": "h264_chunk_sent_to_ws",
  "next": "1456_bytes_packed"
}
```

**Verification**: Chunks should send continuously, roughly every 200ms for 5 FPS.

---

## Test Results Summary

After completing all steps, document:

### Critical Checks

- [ ] Page loads without errors
- [ ] Session tabs appear
- [ ] Terminal connects (green indicator)
- [ ] VNC button enabled
- [ ] VNC modal opens
- [ ] H.264 WebSocket connects
- [ ] MediaSource initialized successfully
- [ ] `h264_decoder_vnc` object exists and has sourceBuffer
- [ ] `h264_decoder_terminal` and `h264_decoder_vnc` are separate objects
- [ ] No `InvalidStateError` in console
- [ ] H.264 chunks append continuously (logs every 200-250ms)

### Screenshots Required

1. **vnc-modal-opened.png** - Immediately after clicking VNC button
   - Shows modal opening and initial connection attempt

2. **vnc-modal-2sec.png** - After 2 seconds
   - Shows WebSocket connected state
   - May show initial video frames starting

3. **vnc-modal-5sec.png** - After 5 seconds total
   - Shows MediaSource initialized
   - Video may display content or black rectangle (both valid)
   - Console shows successful decoder initialization

### Console Log Export

After 5 seconds, right-click console → Save as → `console-logs.txt`

Include in test report.

---

## Decoder Separation Verification (Critical)

Run this in browser console after waiting 5 seconds:

```javascript
const check = {
  has_terminal_decoder: !!window.h264_decoder_terminal,
  has_vnc_decoder: !!window.h264_decoder_vnc,
  are_separate_objects: window.h264_decoder_terminal !== window.h264_decoder_vnc,
  vnc_decoder_ready: !!(window.h264_decoder_vnc?.sourceBuffer),
  terminal_decoder_ready: !!(window.h264_decoder_terminal?.sourceBuffer),
};
console.table(check);
```

**Expected Output**:

| Key | Value |
|-----|-------|
| has_terminal_decoder | true or false |
| has_vnc_decoder | true |
| are_separate_objects | true (if both exist) |
| vnc_decoder_ready | true |
| terminal_decoder_ready | true or false |

**Critical**: `are_separate_objects` must be `true` to prevent MediaSource API conflicts.

---

## Troubleshooting

### Issue: VNC modal shows black rectangle, no updates
**Diagnosis**:
- Check server logs for `h264_chunk_sent_to_ws` entries
- If present: chunks sending but not decoding (client-side issue)
- If absent: FFmpeg not producing output (server-side issue)

**Fix**:
- Verify FFmpeg running: `ps aux | grep ffmpeg`
- Check DISPLAY env var: `echo $DISPLAY`
- Verify X server: `xdpyinfo -display :99`

### Issue: "H.264 Stream: Failed to append chunk" errors
**Diagnosis**: SourceBuffer.updating was true during append

**Fix**: Already applied in commit 28e1f2a
- Code checks: `if (h264_decoder_vnc.sourceBuffer.updating === false)`
- Before: Would crash with InvalidStateError
- After: Chunks queued and retried automatically

### Issue: MediaSource type not supported
**Diagnosis**: `H.264 MIME type not supported` error

**Causes**:
- Browser doesn't support H.264 (unlikely, all modern browsers do)
- Codec string malformed

**Fix**: Code tries two MIME types:
1. `video/mp4; codecs="avc1.42E01E"` (standard)
2. `video/mp4; codecs="avc1"` (fallback)

If both fail: Browser doesn't support H.264 (rare)

### Issue: WebSocket closes immediately after opening
**Diagnosis**: Auth failure or endpoint issue

**Verify**:
1. Session ID valid: `console.log(window.active_session_id)`
2. Token valid: `console.log(sessions.get(window.active_session_id)?.token)`
3. Server responding: Check Network tab for `/api/vnc-video` upgrade

---

## Performance Notes

- **Encoder Bitrate**: 90-160 kbits/s (excellent for network streaming)
- **Latency**: ~500ms typical (200ms frame encoding + 300ms transport)
- **CPU Usage**: FFmpeg x11grab at 5 FPS typically uses 5-10% CPU
- **Memory**: SourceBuffer keeps ~1-2 seconds of video buffered (~500KB)

---

## Success Criteria

**All tests pass when**:

1. ✅ H.264 WebSocket connects successfully
2. ✅ MediaSource API initializes without errors
3. ✅ SourceBuffer exists and accepts H.264 chunks
4. ✅ Decoder objects are separate (`h264_decoder_terminal` !== `h264_decoder_vnc`)
5. ✅ No InvalidStateError or append failures in console
6. ✅ H.264 chunks append continuously every 200-250ms
7. ✅ Video element renders (black or with content, both valid)

**Test Status**: READY TO EXECUTE

---

## Next Steps After Passing

If all tests pass:
1. Document in H264_TEST_RESULTS.md
2. Verify with 3+ different browsers
3. Test on production (https://shelly.247420.xyz)
4. Monitor server logs for any issues
5. Confirm with video actually displaying content (not just black)
