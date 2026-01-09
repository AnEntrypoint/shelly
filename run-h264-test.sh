#!/bin/bash

# H.264 Video Streaming Integration Test
# This script tests the complete H.264 pipeline:
# 1. CLI provider generates H.264 video from X11 display
# 2. Server receives and relays H.264 chunks
# 3. Web browser displays H.264 stream via MediaSource API

set -e

TEST_PASSWORD="test_h264_$(date +%s)"
SERVER_URL="https://shelly.247420.xyz"
DISPLAY=":99"

echo "=============================================="
echo "H.264 Video Streaming Integration Test"
echo "=============================================="
echo ""
echo "Configuration:"
echo "  Server: $SERVER_URL"
echo "  Password: $TEST_PASSWORD"
echo "  Display: $DISPLAY"
echo "  Duration: 60 seconds"
echo ""

# Step 1: Create session
echo "[Step 1] Creating test session..."
SESSION_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/session" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$TEST_PASSWORD\"}")

SESSION_ID=$(echo "$SESSION_RESPONSE" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)
TOKEN=$(echo "$SESSION_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SESSION_ID" ] || [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to create session"
  echo "Response: $SESSION_RESPONSE"
  exit 1
fi

echo "  ✓ Session created: $SESSION_ID"
echo "  ✓ Token: ${TOKEN:0:8}..."
echo ""

# Step 2: Start CLI provider in background
echo "[Step 2] Starting CLI provider..."
cd /home/user/shellyclient
DISPLAY="$DISPLAY" node index.js new "$SERVER_URL" "$TEST_PASSWORD" > /tmp/cli-provider.log 2>&1 &
CLI_PID=$!
echo "  ✓ CLI provider started (PID: $CLI_PID)"
echo ""

# Wait for provider to connect
echo "[Step 3] Waiting for provider to connect (20 seconds timeout)..."
TIMEOUT=20
ELAPSED=0
PROVIDER_CONNECTED=false

while [ $ELAPSED -lt $TIMEOUT ]; do
  SESSIONS_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/sessions/by-password" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"$TEST_PASSWORD\"}")

  # Check if any session has active provider
  if echo "$SESSIONS_RESPONSE" | grep -q '"has_active_provider":true'; then
    PROVIDER_CONNECTED=true
    echo "  ✓ Provider connected successfully"
    break
  fi

  sleep 1
  ELAPSED=$((ELAPSED + 1))
  echo -n "."
done

echo ""

if [ "$PROVIDER_CONNECTED" = false ]; then
  echo "⚠️  Provider did not connect within timeout"
  echo "   Check CLI logs: tail -f /tmp/cli-provider.log"
  echo ""
  echo "   Provider command: DISPLAY=:99 node index.js new $SERVER_URL $TEST_PASSWORD"
  echo ""
fi

# Step 4: Run Playwright test
echo "[Step 4] Starting browser automation test..."
echo ""

cd /home/user/webshell
node test-h264-stream.js

# Step 5: Cleanup
echo ""
echo "[Step 5] Cleaning up..."
kill $CLI_PID 2>/dev/null || true
wait $CLI_PID 2>/dev/null || true
echo "  ✓ CLI provider stopped"
echo ""

echo "=============================================="
echo "Test Complete"
echo "=============================================="
echo ""
echo "Test output:"
echo "  Browser test output: See above"
echo "  CLI provider logs: /tmp/cli-provider.log"
echo "  Screenshot: /home/user/webshell/h264-test-screenshot.png"
echo ""
