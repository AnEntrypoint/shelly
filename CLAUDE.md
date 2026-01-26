# Technical Caveats

## Atomic Command Model
- Each CLI invocation executes exactly one command and exits
- No persistent shell or REPL
- State managed entirely via seed-based persistence, not session IDs
- execute() returns result synchronously; no async waiting

## Seed-Based State Persistence
- Seed uniquely identifies connection context across CLI invocations
- Same seed parameter restores previous state from ~/.shelly/seeds/{seed-hash}.json
- State loaded on access via state.get(seed), auto-saved after each command
- Seed mismatch on import throws error; state NOT portable across different seeds
- Each seed is completely isolated; no cross-seed state sharing

## State File Format
- State files stored at: ~/.shelly/seeds/{SHA256(seed)}.json
- Location determined by crypto.createHash('sha256').update(seed).digest('hex')
- Directory created automatically on first use
- Files are portable JSON; can be manually exported/imported
- File permissions inherited from process umask

## Connection Lifecycle
- connect() command establishes state but does NOT keep process alive
- exec() requires connected state; fails if not connected first
- disconnect() clears connection but preserves state file
- State persists even after disconnect; can reconnect with same seed later

## Error Handling
- All errors return {status: 'error', error: 'message'} with exit code 1
- No exceptions escape; caught at command boundary
- Missing required args throw validation errors with clear messages
- HyperSSH connection failures captured as error strings in result
