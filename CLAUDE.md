# Technical Caveats

## Seed-Based Determinism
- Seed parameter MUST be consistent across skill instances for deterministic behavior
- Seed mismatch on state import throws error; state is NOT portable across seeds
- Multiple skill instances with different seeds create isolated execution contexts

## Plugin System
- PluginManager initialization is async; must await init() before using plugins
- global.telesshPluginManager singleton persists across reloads
- Plugin hooks execute sequentially; async handlers block subsequent hooks
- Plugin unload() must explicitly clean up listeners; orphaned listeners break reload

## Registry and Marketplace
- Registry seed must match on import/export; seed mismatch throws error
- Plugin installation marks as installed; does not auto-load plugin
- Ratings and featured plugins are in-memory; persistence requires explicit export

## Skill Instance Management
- skillInstance persists across calls with same seed; create new TelesshSkill() to reset
- execute() function caches skill by seed; different seeds get separate instances
- Global state lives in global.telesshPluginManager; survives module reloads

## State Management
- Sessions are NOT exported by default; only metadata exported
- State export preserves seed; import fails if seed doesn't match
- Plugin loaded status preserved; plugin paths must be stable across reloads

## Performance Considerations
- Registry search is linear O(n); large registries (>1000 plugins) may be slow
- Checksum computation uses SHA256; significant for large state objects
- Buffer concatenation is O(n); retrieving large buffers rebuilds strings repeatedly
- State export serializes entire registry; large registries produce large exports

## Determinism Scope
- Seed guarantees deterministic STRUCTURE and BEHAVIOR of skill operations
- Seed does NOT guarantee deterministic RESULTS from remote HyperSSH connections
- Same seed = same validation rules, error messages, command outputs
- External systems (SSH servers) are non-deterministic regardless of seed

## Marketplace Implementation
- PluginMarketplace requires indexData config option to load plugins; empty without it
- MarketplaceAPI requires marketplace instance; cannot function standalone
- discover() returns sliced array, pagination handles offset correctly
- getFeatured()/getTrending() return empty array if no plugins marked featured/trending
- Rating calculation: sum / count, rounded to 2 decimals; avoid division by zero
- Trending algorithm: (timeScore × 0.3) + (downloadScore × 0.4) + (ratingScore × 0.3)
- Index data structure: marketplace.plugins object keyed by plugin name (not array)
- Review submission increments rating aggregate atomically; no race conditions
- Installation tracking uses Set; simultaneous install/uninstall may conflict
- Categories initialized on PluginMarketplace construction; adding categories requires reinit
- Search is case-insensitive substring match; no fuzzy matching
- Validation strict on name format (lowercase alphanumeric-hyphen only)
- Plugin metadata immutable after registration; no update() method
