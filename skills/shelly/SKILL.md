---
name: shelly
description: Atomic CLI commands for seeded HyperSSH connections with persistent daemon-based connections.
disable-model-invocation: false
---

# Shelly - Seeded HyperSSH Connection Manager

Run as: `npx -y gxe@latest AnEntrypoint/shelly cli <command>`

## Quick Start

```bash
npx -y gxe@latest AnEntrypoint/shelly cli connect --seed myserver
npx -y gxe@latest AnEntrypoint/shelly cli send --text "ls -la"
npx -y gxe@latest AnEntrypoint/shelly cli disconnect
```

## Commands

### connect --seed <id>
Spawns background daemon maintaining persistent SSH connection.

### send --text "<cmd>"
Executes command via daemon, auto-receives output. Returns `{command, output}`.

### receive
Gets buffered output (empty if already consumed by send).

### status
Shows connection status.

### disconnect
Terminates daemon, cleans socket.

### serve --seed <id> [--port <port>]
Starts persistent server, auto-selects port if not provided.

### stop
Stops server daemon.

## Session-Like Workflow

After connect, subsequent commands don't need --seed:
```bash
npx -y gxe@latest AnEntrypoint/shelly cli connect --seed work
npx -y gxe@latest AnEntrypoint/shelly cli send --text "pwd"
npx -y gxe@latest AnEntrypoint/shelly cli send --text "ls"
npx -y gxe@latest AnEntrypoint/shelly cli disconnect
```

Seed stored in `~/.shelly/current-seed`, auto-read by commands.

## Multiple Sessions

Different seeds for independent daemons:
```bash
npx -y gxe@latest AnEntrypoint/shelly cli connect --seed api
npx -y gxe@latest AnEntrypoint/shelly cli connect --seed db
npx -y gxe@latest AnEntrypoint/shelly cli send --seed api --text "curl /health"
npx -y gxe@latest AnEntrypoint/shelly cli send --seed db --text "psql mydb"
```

## State

- Persists in `~/.shelly/seeds/{SHA256(seed)}.json`
- Daemons listen on `~/.shelly/daemon-{seed}.sock`
- Current seed in `~/.shelly/current-seed`

## Error Format

```json
{"status": "error", "error": "...", "seed": "...", "command": "..."}
```

Exit 1 on error, 0 on success.
