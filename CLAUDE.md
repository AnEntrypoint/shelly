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
serve spawns detached hypertele process via `spawn('npx', ['hypertele', ...], {stdio: 'ignore', detached: true})`. Process unref'd immediately. PID stored in state file for recovery. Process lifecycle NOT managed by parent - survives process exit. Stop command kills process group with SIGTERM via `process.kill(-pid)`.

## Hypertele Unix Socket
hypertele creates unix socket at `/tmp/hypertele-{seed}.sock` for each server. Socket cleaned up on stop. Multiple seeds can serve simultaneously - each has isolated socket and process.

## Port Allocation
serve --port is optional. If not provided, auto-selects random port 9000-9999. Port must be available locally on 127.0.0.1. No validation before spawn - hypertele will fail if port in use. Server state persists in file even if spawn fails - must manually fix port conflict and retry. Response includes `connectWith` field showing the CLI command to connect to the server.

## IPC Communication Protocol
Daemon listens on Unix socket for JSON messages. CLI connects, sends command, waits for response, disconnects. Messages: `{"type": "send", "text": "..."}` and `{"type": "disconnect"}`. Daemon queues commands, executes via execSync, returns output. Timeout 5s per request, daemon timeout 30s for hyperssh execution. Socket cleanup on daemon shutdown.

## Session-Like Seed Interface
After `connect --seed <id>`, the seed is stored in ~/.shelly/current-seed. Subsequent commands (send, receive, status, disconnect) do NOT require --seed - they read from current-seed file. Only connect and serve require explicit --seed on CLI. Disconnect clears the current-seed file. Providing explicit --seed on send/receive/status overrides current-seed for that command but does NOT update the file. This enables session-like workflow without a persistent REPL: `connect --seed X` → `send --text "cmd"` → `receive` → `disconnect`.
