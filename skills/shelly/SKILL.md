---
name: shelly
description: Execute atomic commands on seeded HyperSSH connections. Each command is stateless - maintain context via seed parameter.
disable-model-invocation: false
---

# Shelly - Seeded HyperSSH Automation

Shelly provides atomic command execution on HyperSSH connections. Maintain persistent state across CLI invocations via seed parameter.

## Quick Start

```bash
telessh --seed my-conn --cmd connect --args '{"hypersshSeed":"remote","user":"alice"}'
telessh --seed my-conn --cmd exec --args '{"command":"ls -la"}'
telessh --seed my-conn --cmd status
telessh --seed my-conn --cmd disconnect
```

## Seeds

A seed uniquely identifies a connection context. Same seed across invocations maintains state:
- State saved to `~/.shelly/seeds/{seed-hash}.json`
- Each seed completely isolated
- Reusing seed continues previous connection

## Commands

### connect
```bash
telessh --seed <id> --cmd connect --args '{"hypersshSeed":"<seed>","user":"<user>"}'
```

### exec
```bash
telessh --seed <id> --cmd exec --args '{"command":"<cmd>"}'
```
Requires connect first.

### send
```bash
telessh --seed <id> --cmd send --args '{"data":"<data>"}'
```

### status
```bash
telessh --seed <id> --cmd status
```

### disconnect
```bash
telessh --seed <id> --cmd disconnect
```

### export
```bash
telessh --seed <id> --cmd export
```

### import
```bash
telessh --seed <id> --cmd import --args '{"data":"<json>"}'
```

## State Persistence

State auto-saves to `~/.shelly/seeds/` after every command. Survives process termination and restarts.

## Multiple Connections

Use different seeds for independent connections:
```bash
telessh --seed conn-a --cmd connect --args '{"hypersshSeed":"server-1","user":"admin"}'
telessh --seed conn-b --cmd connect --args '{"hypersshSeed":"server-2","user":"admin"}'
```

## Agent Integration

Agents invoke shelly across turns maintaining connection state:
```javascript
// Turn 1: establish
shell('telessh --seed task-001 --cmd connect --args \'{"hypersshSeed":"api","user":"agent"}\'');

// Turn 2: use same connection
shell('telessh --seed task-001 --cmd exec --args \'{"command":"curl http://localhost/health"}\'');
```

## Error Handling

Errors return `{"status":"error","error":"<message>"}` with exit code 1.

Must call `connect` before `exec`.
