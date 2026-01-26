# Technical Caveats - Telessh Skill Architecture

## Seed-Based Determinism
- Seed parameter MUST be consistent across skill instances for deterministic behavior
- Seed mismatch on state import throws error; state is NOT portable across seeds
- Validators compute checksums based on seed; different seeds = different checksums
- Multiple skill instances with different seeds create isolated execution contexts

## Plugin System
- PluginManager initialization is async; must await init() before using plugins
- global.telesshPluginManager singleton persists across reloads; check !global before creating
- Plugin hooks are ordered; execution order matters for dependent hooks
- Unload must explicitly call plugin.unload() method if defined; cleanup not automatic

## Registry and Marketplace
- Registry seed must match on import/export; seed mismatch throws error
- Plugin installation doesn't load; it only marks as installed in registry
- Marketplace categories are initialized on construction; new categories need explicit add
- Ratings and featured plugins are in-memory; persistence requires explicit export

## State Management
- State export preserves seed; import fails if seed doesn't match
- Sessions are NOT exported by default; only metadata
- Plugins loaded status is preserved; plugin paths must be stable across reloads

## Validation Framework
- Validators maintain state history up to 10000 entries; manual pruning may be needed
- Checksum validation compares against stored checksums; first operation always succeeds
- validateDeterministic requires seed match; it does NOT guarantee algorithmic determinism

## API Contract
- execute() returns { status, error, command, seed } on error
- All commands must provide seed parameter; null seed throws error
- HyperSSH dependency is soft; operations proceed if binary unavailable
- Global debug hooks (telesshDebug) exposed for REPL access

## Hook System
- Hooks execute sequentially; async handlers block subsequent hooks
- Hook errors propagate; failed hook stops execution chain
- executeHook returns last modified data; intermediate transformations cascade
- Pre-hooks validate; post-hooks record; prevent side effects in pre-hooks

## Hot Reload Considerations
- Skill instance NOT reloaded on module change; must create new TelesshSkill() explicitly
- Global state persists but local skill instance does not; export before reload
- Plugin unload() hooks must clean up listeners; orphaned listeners break reload
- Marketplace state not auto-persisted; save via export() before process exit

## Session Manager Integration
- SessionManager is legacy static API; use skill.connect/send/disconnect instead
- HyperSSH spawning may fail if binary not installed; wrapped in try/catch
- Session.buffer is array; large buffers (>10k lines) impact memory significantly
- Process cleanup on disconnect is synchronous; process.kill() blocks briefly

## Predictability Guarantees
- Seed alone does NOT guarantee output determinism; external systems (SSH servers) are non-deterministic
- Skill guarantees deterministic STRUCTURE; not deterministic RESULTS
- Validators check format; they do NOT check remote system behavior
- Same seed = same validation rules and error messages, not same connection outcomes

## Error Recovery
- Registry import on seed mismatch leaves registry in partial state; re-init recommended
- Marketplace import rolls back on any error; atomic semantics not guaranteed
- Plugin load errors don't remove partially-loaded plugins; manual unload needed
- Hook execution errors don't clear pending hooks; remaining hooks still execute

## Performance Considerations
- Registry search is linear O(n); large registries (>1000 plugins) may be slow
- Checksum computation uses SHA256; significant for large state objects
- Buffer concatenation is O(n); retrieving large buffers rebuilds strings repeatedly
- State export serializes entire registry; large registries produce large exports

## File System
- No persistent file storage; all state is in-memory
- Registry/Marketplace cannot load from disk; must be populated programmatically
- Logs retained in memory only; restart clears all logs
- No automatic state checkpointing; must call exportState() manually
