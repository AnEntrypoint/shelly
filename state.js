const persist = require('./persist');

class SeedState {
  constructor() {
    this.seeds = new Map();
  }

  get(seed) {
    if (!this.seeds.has(seed)) {
      let state = persist.load(seed);
      if (!state) {
        state = {
          seed,
          connected: false,
          hypersshSeed: null,
          user: null,
          serving: false,
          serverPort: null,
          serverPid: null,
          createdAt: Date.now(),
          lastCmd: null
        };
      }
      this.seeds.set(seed, state);
    }
    return this.seeds.get(seed);
  }

  save(seed) {
    const state = this.seeds.get(seed);
    if (state) {
      persist.save(seed, state);
    }
  }

  delete(seed) {
    this.seeds.delete(seed);
    persist.delete(seed);
  }

  list() {
    return Array.from(this.seeds.values());
  }

  export(seed) {
    const state = this.get(seed);
    return JSON.stringify(state);
  }

  import(seed, data) {
    const parsed = JSON.parse(data);
    if (parsed.seed !== seed) {
      throw new Error(`Seed mismatch: ${parsed.seed} !== ${seed}`);
    }
    this.seeds.set(seed, parsed);
    this.save(seed);
    return this.seeds.get(seed);
  }

  reset() {
    this.seeds.clear();
  }
}

if (!global.shellyState) {
  global.shellyState = new SeedState();
}

module.exports = global.shellyState;
