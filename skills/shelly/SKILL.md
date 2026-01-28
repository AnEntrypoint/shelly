---
name: shelly
description: Persistent HyperSSH connections with atomic CLI commands. Spawns background daemons to maintain connections between invocations.
disable-model-invocation: false
---

# Shelly - Seeded HyperSSH Connection Manager

Persistent SSH connections through background daemons. Each CLI call is atomic and returns immediately while daemons maintain connections.

**Usage:** `npx -y gxe@latest AnEntrypoint/shelly cli <command> [options]`

## Shell Alias Setup

To simplify commands, create a shell alias:

```bash
alias shelly='npx -y gxe@latest AnEntrypoint/shelly cli'
```

Add this to your `~/.bashrc`, `~/.zshrc`, or equivalent shell config file to persist across sessions.

Once the alias is created, all commands become shorter:

```bash
shelly connect --seed myserver
shelly send --text "ls -la"
shelly status
shelly disconnect
```

This saves tokens and reduces command length while maintaining full functionality.

## Quick Start

With alias (recommended):
```bash
# Start persistent connection (spawns daemon)
shelly connect --seed myserver

# Send command (reuses daemon, auto-receives output)
shelly send --text "ls -la"

# Check status
shelly status

# Terminate daemon
shelly disconnect
```

Without alias:
```bash
# Start persistent connection (spawns daemon)
npx -y gxe@latest AnEntrypoint/shelly cli connect --seed myserver

# Send command (reuses daemon, auto-receives output)
npx -y gxe@latest AnEntrypoint/shelly cli send --text "ls -la"

# Check status
npx -y gxe@latest AnEntrypoint/shelly cli status

# Terminate daemon
npx -y gxe@latest AnEntrypoint/shelly cli disconnect
```

## Commands

### connect --seed <id>
Spawns background daemon that maintains persistent HyperSSH connection.
- Creates `~/.shelly/daemon-{seed}.sock` for IPC
- Saves `~/.shelly/current-seed` for session tracking
- Returns JSON with status, user, seed

### send --text "<command>"
Execute command via daemon, returns output immediately.
- Auto-receives output (no separate receive needed)
- Returns: `{status, command, output}`
- Can use current-seed implicitly or specify `--seed <id>`
- Daemon handles actual execution via hyperssh

### receive
Manually retrieve buffered output (deprecated - send returns output immediately).
- No buffering in current IPC architecture
- Returns: `{status, message, data: ''}`
- Rarely used (send auto-receives output)

### status
Show connection and daemon status.
- Returns: `{status, seed, connected, user, connectedAt}`
- Uses current-seed if available

### disconnect
Terminate daemon gracefully.
- Removes `~/.shelly/current-seed`
- Cleans socket: `~/.shelly/daemon-{seed}.sock`
- Triggers daemon shutdown via IPC

### serve --seed <id> [--port <port>]
Start persistent server daemon.
- Port auto-selected if not provided (9000-9999)
- Returns: `{status, seed, port, pid, connectWith}`
- Stores state in `~/.shelly/seeds/{SHA256(seed)}.json`

### stop
Terminate server daemon (keeps daemon running if also connected).
- Uses `--seed <id>` or active current-seed
- Stops server process gracefully
- Does NOT clear current-seed file (session remains intact)

## Session-Like Workflow

Connect once, send multiple commands without repeating --seed:

With alias:
```bash
shelly connect --seed work
shelly send --text "pwd"
shelly send --text "ls /var"
shelly send --text "whoami"
shelly status
shelly disconnect
```

Without alias:
```bash
npx -y gxe@latest AnEntrypoint/shelly cli connect --seed work
npx -y gxe@latest AnEntrypoint/shelly cli send --text "pwd"
npx -y gxe@latest AnEntrypoint/shelly cli send --text "ls /var"
npx -y gxe@latest AnEntrypoint/shelly cli send --text "whoami"
npx -y gxe@latest AnEntrypoint/shelly cli status
npx -y gxe@latest AnEntrypoint/shelly cli disconnect
```

Active seed stored in `~/.shelly/current-seed`, automatically read by commands. Cleared only by `disconnect` command, not by `stop` (so server can be restarted without reconnecting daemon).

## Multi-Seed Sessions

Run independent daemons simultaneously with different seeds (with alias):

```bash
shelly connect --seed api-prod
shelly connect --seed db-prod
shelly send --seed api-prod --text "curl /health"
shelly send --seed db-prod --text "SELECT 1"
```

Each seed has isolated daemon, state, and connection.

## Architecture

### Persistent Daemons
- Background process per seed
- Listens on Unix socket: `~/.shelly/daemon-{seed}.sock`
- Maintains single HyperSSH connection
- Queues and executes commands
- Survives CLI process exit
- Terminated on disconnect/stop

### IPC Protocol
- CLI connects to daemon socket
- Sends JSON: `{"type": "send", "text": "..."}`
- Daemon executes via hyperssh (30s timeout)
- Returns JSON: `{"status": "success", "output": "..."}`
- Socket timeout: 5s per request

### State Files
- Connection state: `~/.shelly/seeds/{SHA256(seed)}.json`
- Daemon socket: `~/.shelly/daemon-{seed}.sock`
- Active seed: `~/.shelly/current-seed`

## Response Format

Success:
```json
{
  "status": "success",
  "message": "...",
  "seed": "...",
  "command": "...",
  "output": "..."
}
```

Error:
```json
{
  "status": "error",
  "error": "error message",
  "seed": "...",
  "command": "..."
}
```

Exit code: 0 on success, 1 on error

## Daemon Persistence

Daemons persist until explicitly terminated:
- Survive CLI process exit
- Reuse with same seed: `connect --seed X` reconnects
- Prevent reconnection overhead
- Clean shutdown: `disconnect` or `stop`

## HyperSSH Integration

- Requires 32-byte seeds (hypercore-id-encoding)
- Commands executed via: `npx hyperssh -s <seed> -u <user> -e "<command>"`
- User auto-derived from system username
- Timeout: 30 seconds per command
