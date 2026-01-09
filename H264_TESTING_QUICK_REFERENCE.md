# H.264 Testing - Quick Reference Card

**Print this document or keep it visible during testing**

---

## Pre-Test Checklist

- [ ] Server running: `npm run dev` (localhost:3000)
- [ ] Browser open: http://localhost:3000
- [ ] DevTools open: F12
- [ ] Console tab visible
- [ ] Network tab visible (optional)
- [ ] X11 display available (Xvfb :99 or DISPLAY env var)
- [ ] FFmpeg installed: `which ffmpeg`
- [ ] Screenshots directory writable
- [ ] Test password ready: `test_h264_<timestamp>`

---

## Test Flow (30-40 minutes)

### Phase 1: Connection (5-10 min)
1. Page loads ✅
2. Enter password, submit ✅
3. Session tabs appear ✅
4. Click tab, terminal connects (green) ✅
5. VNC button visible and enabled ✅

### Phase 2: Decoder Init (10-15 min)
6. Click VNC button
7. Wait 2 seconds → **Screenshot 1** 📸
8. Check console: "H.264 Stream: Ready message received" ✅
9. Check console: "H.264 Video: Native MediaSource initialized" ✅
10. Wait 5 seconds total → **Screenshot 2** 📸
11. Check console: "Appended N bytes" (repeated) ✅

### Phase 3: Streaming (10-15 min)
12. Wait 5 seconds total → **Screenshot 3** 📸
13. Console: No "InvalidStateError" ✅
14. Console: No "Failed to append chunk" ✅
15. Chunks appending every 200-250ms ✅

### Phase 4: Video (5 min)
16. Video element visible ✅
17. Video tag id="h264-video" ✅
18. Content updates or black rectangle ✅

### Phase 5: Verification (2 min)
19. Run console command (see below) ✅
20. Decoder separation verified ✅

---

## Critical Console Commands

### Command 1: Verify Decoders (Paste after 5 seconds)
```javascript
console.log({
  h264_decoder_terminal: typeof window.h264_decoder_terminal,
  h264_decoder_vnc: typeof window.h264_decoder_vnc,
  are_different: window.h264_decoder_terminal !== window.h264_decoder_vnc,
  vnc_ready: !!(window.h264_decoder_vnc?.sourceBuffer)
});
```

**Expected Output**:
```
Object {
  h264_decoder_terminal: "undefined" or "object",
  h264_decoder_vnc: "object",
  are_different: true,
  vnc_ready: true
}
```

### Command 2: Check WebSocket (Anytime)
```javascript
console.log({
  ws_exists: !!window.h264_video_ws,
  ws_open: window.h264_video_ws?.readyState === 1,
  session_id: window.active_session_id?.substring(0, 8)
});
```

**Expected Output**:
```
Object {
  ws_exists: true,
  ws_open: true,
  session_id: "abcd1234"
}
```

### Command 3: Check SourceBuffer (Anytime)
```javascript
console.log({
  exists: !!window.h264_decoder_vnc?.sourceBuffer,
  updating: window.h264_decoder_vnc?.sourceBuffer?.updating,
  buffered: window.h264_decoder_vnc?.sourceBuffer?.buffered?.length
});
```

**Expected Output**:
```
Object {
  exists: true,
  updating: false,
  buffered: 1
}
```

---

## Expected Console Logs (Look For These)

**Log 1** (immediate):
```
H.264 Stream: WebSocket connected, waiting for frames
```

**Log 2** (within 1-2s):
```
H.264 Stream: Ready message received {width: 1024, height: 768, fps: 5}
```

**Log 3** (within 2-3s):
```
H.264 Video: Native MediaSource initialized with fragmented MP4
H.264 Video: Using standard AVC1 codec
```

**Log 4** (repeated every 200-250ms):
```
H.264 Stream: Appended 1024 bytes
H.264 Stream: Appended 2048 bytes
...
```

---

## Errors to Avoid

### ❌ CRITICAL (Abort if appear)
- InvalidStateError: SourceBuffer in invalid state
- Type "video/mp4; codecs=..." not supported
- WebSocket closes unexpectedly (4001 or other codes)
- h264_decoder_terminal === h264_decoder_vnc (not separate)

### ⚠️ WARNINGS (May appear, not failures)
- "Received frame but decoder not initialized" → Auto-retry
- First few chunks dropped → Expected during init
- MediaSource not open yet → Wait 1-2 seconds

---

## Screenshots to Capture

### 📸 Screenshot 1: VNC Modal Opens (0 seconds)
**After clicking VNC button immediately**

What to see:
- Modal overlay visible
- WebSocket starting to connect
- No errors yet

File: `vnc-modal-opened.png`

### 📸 Screenshot 2: H.264 Connected (2 seconds)
**After 2 seconds from modal open**

What to see:
- WebSocket connected status
- "Ready message received" in console
- MediaSource initializing

File: `vnc-modal-2sec.png`

### 📸 Screenshot 3: Streaming Active (5 seconds)
**After 5 seconds total from modal open**

What to see:
- Video element rendering
- "Appended N bytes" logs in console
- No error messages

File: `vnc-modal-5sec.png`

---

## Success Indicators

### Green Lights ✅ (All Expected)
- [ ] Page loads
- [ ] Sessions appear
- [ ] WebSocket connects
- [ ] MediaSource initializes
- [ ] Decoders separate
- [ ] Chunks append continuously
- [ ] No InvalidStateError
- [ ] Video renders

### Red Lights ❌ (Abort if Any)
- [ ] InvalidStateError appears
- [ ] MIME type not supported
- [ ] WebSocket closes
- [ ] Decoders not separated

---

## Troubleshooting Cheat Sheet

| Problem | Quick Fix |
|---------|-----------|
| Page won't load | Reload browser, check server running |
| Sessions don't appear | Enter valid password, submit |
| VNC button disabled | Need connected terminal first |
| Modal won't open | Check JavaScript errors (F12 console) |
| WebSocket won't connect | Session may have timed out, create new |
| MediaSource unsupported | Try different browser (Chrome, Firefox) |
| Chunks not appending | Check `updating` state (guard clause) |
| Video shows black forever | Check FFmpeg: `ps aux \| grep ffmpeg` |
| Memory leak warnings | Reload page, clear decoders |

---

## Server Logs to Monitor

**Good Log**:
```
h264_stream_started: 1024x768@5fps
h264_chunk_ready_to_send: 1024_bytes
h264_chunk_sent_to_ws: 1456_bytes_packed
```

**Bad Log**:
```
h264_stream_init_failed: Cannot find display
ffmpeg_spawn_error: Permission denied
h264_ws_not_ready: readyState=2
```

---

## Timing Reference

| Event | Time After Modal Open | Note |
|-------|--------|------|
| WebSocket opens | 0-500ms | Should be fast |
| Ready message | 500-1000ms | Server confirms ready |
| MediaSource init | 1500-2000ms | Browser decoder setup |
| First chunk | 2000-3000ms | FFmpeg output arriving |
| Steady chunks | 200-250ms interval | Per chunk rate |
| SourceBuffer ready | 2000-3000ms | Safe to append |

---

## Data to Collect

**Before submitting test results**:

1. **Screenshots** (3 files)
   - vnc-modal-opened.png
   - vnc-modal-2sec.png
   - vnc-modal-5sec.png

2. **Console Logs** (Export)
   - F12 → Console → Right-click → Save as → console-logs.txt
   - Include all H.264 related messages
   - Include any error messages

3. **Test Observations**
   - Total duration
   - Any unexpected behavior
   - Frame rate observations
   - Video content visible or black

4. **Server Logs** (Last 30 lines)
   - Check for H.264 errors
   - Check for FFmpeg messages
   - Check for WebSocket errors

---

## Pass/Fail Decision

### TEST PASSES IF ✅
1. All 5 phases complete without errors
2. All console commands return expected values
3. No InvalidStateError in logs
4. Decoders are separate objects
5. 3 screenshots captured successfully
6. Video element renders
7. Chunks append continuously

### TEST FAILS IF ❌
1. InvalidStateError appears
2. MediaSource type not supported
3. WebSocket disconnects unexpectedly
4. Decoders are same object (conflict)
5. Cannot capture screenshots
6. Video element doesn't render
7. Chunks stop appending

---

## Next Steps After Testing

### If PASSED ✅
```
1. Create: H364_TEST_RESULTS.md
2. Attach: 3 screenshots
3. Include: Console logs, observations
4. Deploy: To production server
5. Monitor: Watch logs for 30 minutes
```

### If FAILED ❌
```
1. Collect: All diagnostic data
2. Review: Troubleshooting guide
3. Identify: Which phase failed
4. Escalate: Reference commit analysis
5. Fix: Create new commit if needed
6. Re-test: Verify fix works
```

---

## Key Contacts & References

### Documentation
- H364_TESTING_COMPLETE_SUMMARY.md (overview)
- H364_TEST_MANUAL_GUIDE.md (detailed steps)
- COMMIT_28E1F2A_DETAILED_ANALYSIS.md (technical)

### Commands
- Server: `npm run dev`
- X11 Check: `xdpyinfo -display :99`
- FFmpeg Check: `ps aux | grep ffmpeg`
- Display Check: `echo $DISPLAY`

### URLs
- Local: http://localhost:3000
- Production: https://shelly.247420.xyz

---

## Test Duration Estimate

| Phase | Time | Running Total |
|-------|------|---|
| Setup | 5 min | 5 min |
| Read docs | 10 min | 15 min |
| Phase 1 | 5 min | 20 min |
| Phase 2 | 10 min | 30 min |
| Phase 3 | 10 min | 40 min |
| Phase 4 | 5 min | 45 min |
| Phase 5 | 5 min | 50 min |
| Documentation | 10 min | 60 min |

**Total**: 50-60 minutes (can be 30-40 min with experience)

---

## Final Checklist Before Submission

- [ ] All 5 phases completed
- [ ] 3 screenshots captured
- [ ] Console logs exported
- [ ] Decoder separation verified
- [ ] No critical errors found
- [ ] Video element verified
- [ ] Test results documented
- [ ] All observations recorded
- [ ] PASS/FAIL decision made
- [ ] Next steps identified

---

**Status**: READY ✅

**Start**: H364_TEST_MANUAL_GUIDE.md

**Duration**: 50-60 minutes

**Expected Outcome**: Full H.264 video streaming in VNC modal

---

**Quick Links**:
- 📋 Manual Guide: H364_TEST_MANUAL_GUIDE.md
- 📊 Complete Summary: H364_TESTING_COMPLETE_SUMMARY.md
- 📚 Detailed Specs: H364_TEST_VERIFICATION_STATUS.md
- 🔧 Technical Analysis: COMMIT_28E1F2A_DETAILED_ANALYSIS.md
- 🗺️ Navigation: H364_TESTING_INDEX.md

---

**Last Updated**: 2026-01-09 23:35 UTC
