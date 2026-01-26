# Technical Caveats

## Atomic Command Model
- Each CLI invocation executes exactly one command and exits
- No persistent shell or REPL
- State managed entirely via seed-based persistence, not session IDs
- execute() returns result synchronously; no async waiting

## Seed-Based State Persistence
- Seed uniquely identifies connection context across CLI invocations
- Same seed parameter restores previous state from ~/.telessh/seeds/{seed-hash}.json
- State loaded on access via state.get(seed), auto-saved after each command
- Each seed is completely isolated; no cross-seed state sharing

## State File Format
- State files stored at: ~/.telessh/seeds/{SHA256(seed)}.json
- Location determined by crypto.createHash('sha256').update(seed).digest('hex')
- Directory created automatically on first use
- File permissions inherited from process umask

## Core Commands
- connect: establishes connection state (requires hypersshSeed and user)
- exec: executes command via HyperSSH (requires connected state)
- status: shows connection state and metadata
- disconnect: clears connection but preserves state file

## Connection Lifecycle
- connect() establishes state but does NOT keep process alive
- exec() requires connected state; fails if not connected first
- disconnect() clears connection but preserves state file
- State persists even after disconnect; can reconnect with same seed later

## Command Execution
- exec() uses execSync() with real HyperSSH: `npx hyperssh -s <seed> -u <user> -e "<command>"`
- Output returned as string in result.output
- 30s timeout per command execution
- Invalid seeds cause "ID must be 32-bytes long" error from hyperdht

## Error Handling
- All errors return {status: 'error', error: 'message'} with exit code 1
- No exceptions escape; caught at command boundary
- Missing required args throw validation errors with clear messages
- HyperSSH connection failures captured as error strings in result
