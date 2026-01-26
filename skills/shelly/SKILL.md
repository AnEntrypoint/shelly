---
name: shelly
description: Atomic CLI commands for seeded HyperSSH connections with persistent state management.
disable-model-invocation: false
---

# Shelly - Seeded HyperSSH Connection Manager

Shelly manages HyperSSH connections via atomic CLI commands with seed-based state persistence. Each command is independent; state survives across CLI invocations and process restarts.

## Quick Start

Establish connection:
```bash
shelly connect --seed work --hypersshSeed prod-server --user alice
```

Execute command:
```bash
shelly exec --seed work --command "ls -la"
```

Check status:
```bash
shelly status --seed work
```

Disconnect:
```bash
shelly disconnect --seed work
```

## Seeds

A seed uniquely identifies a connection context. Same seed restores previous state:
- State saved to `~/.telessh/seeds/{SHA256(seed)}.json`
- Each seed completely isolated
- Reusing seed in any CLI call resumes previous connection

## Commands

### connect

Establish connection to a remote host.

```bash
shelly connect --seed <id> --hypersshSeed <host> --user <user>
```

Example:
```bash
shelly connect --seed work --hypersshSeed prod-01 --user alice
```

### exec

Execute command on connected host.

```bash
shelly exec --seed <id> --command <cmd>
```

Example:
```bash
shelly exec --seed work --command "ls -la /var"
```

### status

Show connection status and metadata.

```bash
shelly status --seed <id>
```

### disconnect

Close connection (state file preserved).

```bash
shelly disconnect --seed <id>
```

### export

Export state as JSON.

```bash
shelly export --seed <id>
```

### import

Import previously exported state.

```bash
shelly import --seed <id> --data <json>
```

## State Persistence

- State auto-saves after each command execution
- Survives process termination and system restart
- Reuse same seed to resume from previous state
- State stored at `~/.telessh/seeds/{SHA256(seed)}.json`

## Multiple Sessions

Use different seeds for independent connections:

```bash
shelly connect --seed api-server --hypersshSeed api-prod --user alice
shelly connect --seed database --hypersshSeed db-prod --user bob

shelly exec --seed api-server --command "curl /health"
shelly exec --seed database --command "pg_dump mydb"
```

Each seed maintains completely isolated state.

## Error Handling

All errors return JSON with status field:

```json
{
  "status": "error",
  "error": "error message",
  "seed": "...",
  "command": "..."
}
```

Exit code 1 on error, 0 on success. Common errors:
- Missing required args: `error: <fieldname> required`
- Not connected: `error: Not connected. Call connect first`
- Unknown command: `error: Unknown command: <cmd>`
