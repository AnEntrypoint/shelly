# Technical Caveats

## Atomic Command Model (Critical Design)
Each CLI invocation executes one command and exits. State persists via files, not sessions. No REPL. No persistent process. Each call is independent and atomic.

## Seed-Based State Files
State persists in `~/.telessh/seeds/{SHA256(seed)}.json`. Seed uniquely identifies connection context. Same seed in new process auto-restores previous state. Each seed completely isolated from others.

## execSync with HyperSSH
exec() uses `execSync('npx hyperssh -s <seed> -u <user> -e "<command>"')` with 30s timeout. Output captured as string. Shells special chars in command with double quotes.

## 32-Byte Seed Requirement
HyperSSH/hyperdht requires exactly 32-byte seeds (base32 encoded). Invalid seeds cause "ID must be 32-bytes long" error from hypercore-id-encoding. Real seeds from hyper infrastructure only.

## JSON Error Format
All errors return `{status: 'error', error: 'message', seed, command}` with exit code 1. Clients must check status field, not exit code alone. stdout contains all output (success and errors).

## State File Isolation
No cross-seed state sharing. Disconnect preserves state file. Can reconnect to same host with same seed. Requires explicit connect before exec. Missing hypersshSeed or user validates before attempting connection.
