# Shelly - Persistent HyperSSH Connection Manager

Atomic CLI commands managing background daemon processes for persistent HyperSSH connections.

## Quick Start

### 1. Setup Shell Alias (Recommended)

Add to `~/.bashrc`, `~/.zshrc`, or equivalent:

```bash
alias shelly='npx -y gxe@latest AnEntrypoint/shelly cli'
```

### 2. Basic Workflow

```bash
# Connect with seed (spawns daemon)
shelly connect --seed myserver

# Send commands (reuses daemon, auto-receives output)
shelly send --text "ls -la"
shelly send --text "pwd"

# Check status
shelly status

# Disconnect when done
shelly disconnect
```

### 3. Without Alias

```bash
npx -y gxe@latest AnEntrypoint/shelly cli connect --seed myserver
npx -y gxe@latest AnEntrypoint/shelly cli send --text "ls -la"
npx -y gxe@latest AnEntrypoint/shelly cli status
npx -y gxe@latest AnEntrypoint/shelly cli disconnect
```

## Commands

| Command | Syntax | Purpose |
|---------|--------|---------|
| connect | `shelly connect --seed <id>` | Spawn daemon for persistent connection |
| send | `shelly send --text "<cmd>"` | Execute command, get output immediately |
| status | `shelly status` | Check connection and daemon health |
| disconnect | `shelly disconnect` | Stop daemon, clean up |
| serve | `shelly serve --seed <id> [--port <port>]` | Start server daemon |
| stop | `shelly stop` | Stop server daemon |

## Response Format

**Success:**
```json
{
  "status": "success",
  "message": "...",
  "seed": "...",
  "output": "..."
}
```

**Error:**
```json
{
  "status": "error",
  "error": "error message",
  "seed": "..."
}
```

Exit code: 0 on success, 1 on error

## Key Features

- **Session-like workflow**: Connect once, send multiple commands without repeating --seed
- **Persistent daemons**: Background processes survive CLI exit
- **Multi-seed support**: Run multiple independent sessions simultaneously
- **Atomic CLI**: Each command returns immediately, daemon handles async
- **State persistence**: Connection state survives process exit and reboot
- **Health checks**: Auto-detect stale connections and servers

## State Files

- `~/.shelly/current-seed`: Active seed (for session workflow)
- `~/.shelly/daemon-{seed}.sock`: Unix socket for IPC
- `~/.shelly/seeds/{hash}.json`: Persisted connection state

## Error Recovery

If daemon becomes stale after reboot or crash:

```bash
# Automatic detection and recovery
shelly status
# Output: warning about stale daemon

# Reconnect with same seed
shelly connect --seed myserver
# New daemon spawned, state restored
```

## See Also

- `SKILL.md`: Complete command documentation and examples
- `CLAUDE.md`: Technical specifications and implementation details
- `E2E_TEST_PLAN.md`: Comprehensive testing guide
