# E2E Test Plan - Shelly

This document defines comprehensive end-to-end testing for the shelly project to ensure 100% predictability across all flows.

## Prerequisites
- Shell alias setup: `alias shelly='npx -y gxe@latest AnEntrypoint/shelly cli'`
- Fresh environment: `rm -rf ~/.shelly/` to clear state
- Node.js available
- HyperSSH connectivity available

## Test Flows

### Test Flow 1: Basic Connect-Send-Disconnect (Session-Like)
**Objective**: Verify basic session workflow without explicit seed parameters.

Steps:
```bash
# 1. Connect with seed
shelly connect --seed test-e2e-flow-1
# Expected: {status: 'success', message: 'Connected', seed: 'test-e2e-flow-1', user: '<username>'}
# File check: ~/.shelly/current-seed should contain 'test-e2e-flow-1'

# 2. Send command (using implicit current-seed)
shelly send --text "echo 'Hello from shelly'"
# Expected: {status: 'success', message: 'Sent and received', seed: 'test-e2e-flow-1', command: '...', output: 'Hello from shelly\n'}

# 3. Send another command
shelly send --text "pwd"
# Expected: {status: 'success', message: 'Sent and received', seed: 'test-e2e-flow-1', command: 'pwd', output: '<path>\n'}

# 4. Status check (using implicit current-seed)
shelly status
# Expected: {status: 'success', seed: 'test-e2e-flow-1', createdAt: '<timestamp>', connected: true, user: '<username>', connectedAt: '<timestamp>'}

# 5. Disconnect (clears current-seed)
shelly disconnect
# Expected: {status: 'success', message: 'Disconnected', seed: 'test-e2e-flow-1'}
# File check: ~/.shelly/current-seed should NOT exist

# 6. Verify disconnected (should fail without current-seed)
shelly send --text "echo test"
# Expected: {status: 'error', error: '--seed required (or run "connect --seed <id>" first)'}
```

### Test Flow 2: Multi-Seed Concurrent Sessions
**Objective**: Verify multiple independent daemons can run simultaneously.

Steps:
```bash
# 1. Connect to first seed
shelly connect --seed test-multi-seed-1
# Expected: Connected, current-seed set to test-multi-seed-1

# 2. Connect to second seed (overwrites current-seed)
shelly connect --seed test-multi-seed-2
# Expected: Connected, current-seed set to test-multi-seed-2

# 3. Send to explicit seed (test-multi-seed-1)
shelly send --seed test-multi-seed-1 --text "echo 'From seed 1'"
# Expected: Success, both daemons still running

# 4. Send to implicit seed (test-multi-seed-2)
shelly send --text "echo 'From seed 2'"
# Expected: Success

# 5. Status on explicit seed-1
shelly status --seed test-multi-seed-1
# Expected: Connected, seed='test-multi-seed-1'

# 6. Status on implicit seed-2
shelly status
# Expected: Connected, seed='test-multi-seed-2'

# 7. Disconnect seed-2
shelly disconnect
# Expected: Disconnected

# 8. Verify seed-1 still alive
shelly send --seed test-multi-seed-1 --text "echo 'seed1 still works'"
# Expected: Success

# 9. Disconnect seed-1
shelly disconnect --seed test-multi-seed-1
# Expected: Disconnected
```

### Test Flow 3: Explicit vs Implicit Seed Behavior
**Objective**: Verify that explicit --seed overrides current-seed without updating it.

Steps:
```bash
# 1. Connect to default seed
shelly connect --seed test-explicit-1
# Expected: current-seed='test-explicit-1'

# 2. Send with explicit different seed (should fail - daemon doesn't exist)
shelly send --seed test-explicit-2 --text "echo test"
# Expected: {status: 'error', error: 'Daemon not running...'}
# Check: current-seed still='test-explicit-1'

# 3. Connect second seed
shelly connect --seed test-explicit-2

# 4. Send to explicit seed-1 (overrides current-seed-2)
shelly send --seed test-explicit-1 --text "echo 'explicit'"
# Expected: Success
# Check: current-seed should STILL be 'test-explicit-2'

# 5. Verify current-seed unchanged
shelly status | grep seed
# Expected: seed='test-explicit-2'
```

### Test Flow 4: Positional vs Flag Arguments
**Objective**: Verify both `send "cmd"` and `send --text "cmd"` work identically.

Steps:
```bash
# 1. Setup
shelly connect --seed test-args-1

# 2. Send with flag syntax
shelly send --text "echo flag-syntax"
# Expected: Success

# 3. Send with positional syntax
shelly send "echo positional-syntax"
# Expected: Success

# 4. Mixed (positional should take precedence if both provided)
shelly send "positional" --text "flag"
# Expected: Executes 'positional'
```

### Test Flow 5: Health Checks and Stale Daemon Detection
**Objective**: Verify daemon health checks work correctly.

Steps:
```bash
# 1. Connect
shelly connect --seed test-health-1
# Expected: Connected

# 2. Status - daemon is alive
shelly status
# Expected: connected=true

# 3. Kill daemon externally
pkill -f "daemon.js test-health-1"

# 4. Status - detects stale daemon
shelly status
# Expected: {status: 'success', ..., warning: 'Daemon is not responding. Stale connection detected...', connected: false}
# Check: State cleared (ctx.connected=false, ctx.daemonPid=null)

# 5. Try to send to stale daemon
shelly send --text "echo test"
# Expected: {status: 'error', error: 'Daemon is not responding. Stale connection detected...'}

# 6. Reconnect
shelly connect --seed test-health-1
# Expected: New daemon spawned

# 7. Send succeeds
shelly send --text "echo reconnected"
# Expected: Success
```

### Test Flow 6: Serve/Stop Workflow
**Objective**: Verify server spawning and management.

**Note**: Serve workflow requires hypertele-server package availability. May skip if not installed.

Steps:
```bash
# 1. Serve without explicit port (auto-select 9000-9999)
shelly serve --seed test-serve-1
# Expected: {status: 'success', ..., port: <assigned>, pid: <pid>, connectWith: 'shelly connect --seed test-serve-1'}
# Check: ~/.shelly/current-seed='test-serve-1'

# 2. Try to serve same seed again (should fail)
shelly serve --seed test-serve-1
# Expected: {status: 'error', error: 'Already serving on this seed'}

# 3. Serve with explicit port
shelly serve --seed test-serve-2 --port 19000
# Expected: {status: 'success', port: 19000}

# 4. Status check
shelly status
# Expected: serving=true, serverPort=19000, serverPid=<pid>

# 5. External kill of server
kill <pid-of-test-serve-2>

# 6. Status detects stale server
shelly status
# Expected: warning about server process, serving=false

# 7. Stop current server
shelly stop
# Expected: Server already killed, or clean stop

# 8. Stop named seed
shelly stop --seed test-serve-1
# Expected: Server stopped (clears current-seed if was active)
```

### Test Flow 7: Error Response Format
**Objective**: Verify all errors follow JSON format and exit code conventions.

Steps:
```bash
# 1. Missing seed
shelly send --text "echo test" 2>&1
# Expected: Exit code 1, stderr has 'Error: --seed required'

# 2. Invalid command
shelly invalid-command 2>&1
# Expected: Exit code 1, stderr has 'Error: command required'

# 3. Command execution error (bad command sent to daemon)
shelly connect --seed test-error-1
shelly send --text "invalidcommand-that-doesnt-exist"
# Expected: Exit code 0 (IPC success), output contains ERROR from daemon

# 4. Daemon timeout
# This is hard to test reliably; can be documented as limitation
```

### Test Flow 8: State File Persistence
**Objective**: Verify state persists and restores correctly.

Steps:
```bash
# 1. Connect and serve simultaneously
shelly connect --seed test-persist-1
shelly serve --seed test-persist-2 --port 19001

# 2. List state files
ls ~/.shelly/seeds/
# Expected: Two JSON files (SHA256 hashes of seeds)

# 3. Kill all daemons and servers
pkill -f "daemon.js"
pkill -f "hypertele-server"

# 4. Reconnect (state should restore)
shelly status --seed test-persist-1
# Expected: connected=false (daemon dead), shows createdAt from before

# 5. Fresh connect (reuses state)
shelly connect --seed test-persist-1
# Expected: daemon spawned, createdAt unchanged (loaded from file)
```

### Test Flow 9: Argument Parsing Edge Cases
**Objective**: Verify complex argument scenarios.

Steps:
```bash
# 1. Command with quotes
shelly connect --seed test-args-complex
shelly send --text "echo 'single quotes' && echo \"double quotes\""
# Expected: Properly escaped and executed

# 2. Command with escaped characters
shelly send --text "echo test\\ with\\ spaces"
# Expected: Success

# 3. Command with variables
shelly send --text "echo $USER"
# Expected: Variable expanded by shell (may show username or literal $USER depending on shell)
```

## Verification Checklist

After running all tests:
- [ ] All JSON responses are valid (parseable)
- [ ] All exit codes correct (0 for success, 1 for error)
- [ ] Socket files cleaned up properly after disconnect
- [ ] State files persist across reconnections
- [ ] Multi-seed sessions don't interfere
- [ ] Health checks properly detect stale processes
- [ ] Current-seed file accurately reflects active seed
- [ ] Explicit --seed doesn't pollute current-seed state
- [ ] Error messages are clear and actionable
- [ ] No orphaned processes after completion

## Known Limitations

1. **Real HyperSSH seeds**: Tests assume valid seeds. Invalid seeds may not work without actual hyper infrastructure.
2. **hypertele-server availability**: Serve/stop tests may fail if hypertele-server is not installed.
3. **Network conditions**: Tests assume stable local network (Unix sockets on localhost).
4. **Process timing**: Daemon startup detection polls for 5 seconds (50 * 100ms) - if slower systems need adjustment.

## Documentation Consistency

After fixes, verify these documents match:
- [ ] README.md - Quick start examples
- [ ] SKILL.md - Complete command documentation
- [ ] CLAUDE.md - Technical specifications
- All show consistent seed handling, response formats, and command syntax
