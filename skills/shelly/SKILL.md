---
name: shelly
description: Interactive REPL for seeded HyperSSH connections with persistent state management.
disable-model-invocation: false
---

# Shelly - Seeded HyperSSH Connection Manager

Shelly provides an interactive REPL for managing HyperSSH connections with seed-based state persistence. One session per seed, with state surviving process restarts.

## Quick Start

### Interactive Session

```bash
shelly serve --seed my-conn
```

Inside the session:

```
shelly> connect remote-host alice
✓ Connected to remote-host as alice

shelly> exec ls -la
✓ Executed: ls -la

shelly> read
--- Output ---
$ ls -la
Executed on remote-host
--- End ---

shelly> exit
✓ Exiting session
```

### Quick Status Check

```bash
shelly connect --seed my-conn
Session: my-conn
Connected: true
Host: remote-host
User: alice
```

## Seeds

A seed uniquely identifies a connection context. Same seed reopens the previous session:
- State saved to `~/.telessh/seeds/{seed-hash}.json`
- Each seed completely isolated
- Reusing seed resumes previous connection

## REPL Commands (serve mode)

### connect \<host\> \<user\>

Establish connection to a remote host.

```
shelly> connect my-server alice
✓ Connected to my-server as alice
```

### exec \<command\>

Execute command on connected host. Output stored in buffer.

```
shelly> exec ls -la
✓ Executed: ls -la
```

### read

Display buffered output and clear it.

```
shelly> read
--- Output ---
$ ls -la
Executed on my-server
--- End ---
```

### exit

Close session and save state. State persists for next session with same seed.

```
shelly> exit
✓ Exiting session
```

## State Persistence

- State auto-saves after each command
- Survives session exit and process restart
- Access with same seed to resume previous connection
- State stored at `~/.telessh/seeds/{SHA256(seed)}.json`

## Multiple Sessions

Use different seeds for independent connections:

```bash
shelly serve --seed api-server
# ... do work ...

# In another terminal
shelly serve --seed database
# ... do work ...
```

Check status of any session without opening it:

```bash
shelly connect --seed api-server
```

## Error Handling

- Missing required args: `✗ Usage: connect <host> <user>`
- Not connected: `✗ Not connected. Use: connect <host> <user>`
- Unknown command: displays available commands
- Errors prefixed with `✗` on stderr
