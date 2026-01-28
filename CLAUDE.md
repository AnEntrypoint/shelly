# Technical Caveats

## Daemon-Based Persistent Connections
CLI remains atomic but background daemon maintains persistent SSH connections. `connect --seed X` spawns daemon listening on ~/.shelly/daemon-{seed}.sock. Subsequent `send`/`receive`/`status` communicate with daemon via Unix socket IPC. Daemon handles connection lifecycle, CLI returns immediately. `disconnect` terminates daemon and cleans socket.

## Seed-Based State Files
State persists in `~/.shelly/seeds/{SHA256(seed)}.json`. Seed uniquely identifies connection context. Same seed in new process auto-restores previous state. Each seed completely isolated from others.

## execSync with HyperSSH
exec() uses `execSync('npx hyperssh -s <seed> -u <user> -e "<command>"')` with 30s timeout. Output captured as string. Shells special chars in command with double quotes.

## 32-Byte Seed Requirement
HyperSSH/hyperdht requires exactly 32-byte seeds (base32 encoded). Invalid seeds cause "ID must be 32-bytes long" error from hypercore-id-encoding. Real seeds from hyper infrastructure only.

## JSON Error Format
All errors return `{status: 'error', error: 'message', seed, command}` with exit code 1. Clients must check status field, not exit code alone. stdout contains all output (success and errors).

## State File Isolation
No cross-seed state sharing. Disconnect preserves state file. Can reconnect to same host with same seed. Requires explicit connect before exec.

## Minimal Seed Interface
Seed IS the connection identifier and HyperSSH key. No separate parameters. User auto-derived from `os.userInfo().username`. Commands: `serve --seed <id> [--port <port>]` and `connect --seed <id>`. No --user or --hypersshSeed parameters needed.

## Process Spawning (serve command)
serve spawns detached hypertele-server process via `spawn('npx', ['hypertele-server', '-l', port, '--seed', seedHex, '--private'], {stdio: 'ignore', detached: true})`. Seed is SHA256 hash of user seed converted to hex (64 chars). Process unref'd immediately. PID stored in state file for recovery. Process lifecycle NOT managed by parent - survives process exit. Stop command kills process group with SIGTERM via `process.kill(-pid)`.

## Hypertele Server Seed Format
hypertele-server requires --seed parameter as 64-character hex string (32 bytes). Seed derived via `crypto.createHash('sha256').update(seed).digest().toString('hex')`. hyperdht validates exact byte length at startup - invalid format causes "seed must be crypto_sign_SEEDBYTES bytes long" error. Multiple seeds can serve simultaneously with isolated processes and no socket files.

## Port Allocation
serve --port is optional. If not provided, auto-selects random port 9000-9999. Port must be available locally on 127.0.0.1. No validation before spawn - hypertele will fail if port in use. Server state persists in file even if spawn fails - must manually fix port conflict and retry. Response includes `connectWith` field showing the CLI command to connect to the server.

## IPC Communication Protocol
Daemon listens on Unix socket for JSON messages. CLI connects, sends command, waits for response, disconnects. Messages: `{"type": "send", "text": "..."}` and `{"type": "disconnect"}`. Daemon queues commands, executes via execSync, returns output. Timeout 5s per request, daemon timeout 30s for hyperssh execution. Socket cleanup on daemon shutdown.

## Session-Like Seed Interface
After `connect --seed <id>`, the seed is stored in ~/.shelly/current-seed. Subsequent commands (send, receive, status, disconnect) do NOT require --seed - they read from current-seed file. Only connect and serve require explicit --seed on CLI. Disconnect clears the current-seed file. Providing explicit --seed on send/receive/status overrides current-seed for that command but does NOT update the file. This enables session-like workflow without a persistent REPL: `connect --seed X` → `send --text "cmd"` → `receive` → `disconnect`.

## Daemon Reboot Behavior
Daemon processes don't survive system reboot but ~/.shelly/current-seed file persists. After reboot, current-seed file may reference a dead daemon. Commands will fail with "Not connected" error. Solution: run `disconnect` to clear stale current-seed, then `connect --seed <id>` to spawn new daemon. Or use explicit `--seed` to bypass current-seed file entirely.

## Connection Error Detection
Daemon detects remote SSH connection closure via execSync error pattern matching: `Connection reset|Connection refused|read: Connection reset|write: EPIPE|ECONNREFUSED|ETIMEDOUT|kex_exchange_identification`. When connection error detected, daemon immediately schedules graceful exit which removes socket file ~/.shelly/daemon-{seed}.sock (current-seed file ownership remains with CLI, never deleted by daemon). Prevents daemon from staying alive with dead connection. Next CLI command finds missing socket and returns "Daemon not running. Run 'connect --seed <id>' first" - user can reconnect with single command.

## Health Checks After Reboot
State files persist across reboot but daemon/server processes do not. Commands verify actual process health before executing: isDaemonHealthy() probes socket connection (not just file existence), isProcessAlive() verifies process via kill(pid, 0). Applied in send/status/disconnect/serve/stop before operations. When stale detected, state automatically cleared (ctx.connected=false, ctx.serving=false) and clear error returned directing user to reconnect. No manual cleanup needed. Reboot scenario: state file says connected=true but daemon dead, first status/send detects it immediately and clears state.

## CLI Argument Parsing - Positional and Flag Arguments
send command accepts both `send "command"` (positional) and `send --text "command"` (flag). parseArgs() tracks positional arguments separately from named flags. Both syntaxes are valid and resolve to same handler. Positional arg takes precedence if both provided.

## Daemon Socket Response Before Exit
Daemon must write socket response BEFORE calling exitGracefully(). If process.exit() called before socket.end() completes, client receives empty response causing "Invalid response:" error. Solution: executeSend() returns structured object {output, connectionLost}, exitGracefully() deferred to setTimeout after socket response sent. Critical for reliable IPC.

## Daemon File Ownership
Daemon only owns its own socket file ~/.shelly/daemon-{seed}.sock. Must never delete current-seed file (owned by CLI) even on exit. exitGracefully() cleans socket only, current-seed persists so user can reconnect with single `connect` command. Cross-ownership violations break session recovery.

## Status Command Health Check
status command checks process health BEFORE returning response. If ctx.serverPid exists, validates via health.isProcessAlive(pid) (uses process.kill(pid, 0)). Updates ctx.serving state in-memory and persists to file. When server process dies externally, status immediately reports serving: false with warning and clears serverPid/serverPort state. This ensures state always reflects reality. Similar pattern for daemons: isDaemonHealthy() probes socket connection and returns boolean. Port argument from CLI parsed as integer via parseInt(args.port, 10) to ensure numeric comparison and storage. Port must be valid (1-65535) - invalid ports rejected at CLI level with clear error message.

## Socket Write Flushing and IPC Reliability
Daemon must ensure socket.write() flushes to kernel BEFORE calling exitGracefully() or socket.end(). Implementation uses socket.write() callback to defer socket.end() and exit until write completes. This prevents clients from receiving empty responses ("Invalid response:" errors). Critical for both send and disconnect message handlers. Signal handlers (SIGTERM/SIGINT) allow 500ms grace period before exit to permit in-flight request completion.

## JSON Parsing Error Handling
All JSON parsing (daemon.js, ipc.js, commands.js) includes try-catch error handling. Malformed messages in daemon trigger graceful error response and socket closure without crashing daemon. Client-side parsing errors similarly handled with clear "Invalid response:" messages.

## Daemon Startup Robustness
startDaemon() spawns daemon with error handler on server.listen(). If socket binding fails (permissions, filesystem issues), daemon exits cleanly rather than silently crashing. Parent process timeout (5s) ensures it detects failed startup and rejects promise. Multiple simultaneous startDaemon() calls are safe due to daemon-level error handling (only one daemon binds successfully).

## receive Command
The receive() command is available but deprecated in current architecture. send() immediately returns output via IPC (no buffering), so receive() is rarely needed. Returns status message indicating no buffered data. Kept for backwards compatibility with older workflows.
