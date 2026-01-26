class PredictabilityValidator {
  constructor(config = {}) {
    this.config = config;
    this.checksums = new Map();
    this.stateHistory = [];
    this.seed = config.seed || 'default';
    this.level = config.level || 'strict';
  }

  validateState(state) {
    const checksum = this.computeChecksum(state);
    const stored = this.checksums.get(state.id);

    if (stored && stored !== checksum) {
      throw new Error(`State corruption detected for ${state.id}`);
    }

    this.checksums.set(state.id, checksum);
    return true;
  }

  validateSeed(seed) {
    if (typeof seed !== 'string' || seed.length === 0) {
      throw new Error('Invalid seed: must be non-empty string');
    }
    if (seed.length > 1024) {
      throw new Error('Seed exceeds maximum length of 1024 characters');
    }
    return true;
  }

  validateOperation(op, data) {
    if (!op || typeof op !== 'string') {
      throw new Error('Operation must be string');
    }
    if (!data || typeof data !== 'object') {
      throw new Error('Data must be object');
    }

    const required = this.getRequiredFields(op);
    for (const field of required) {
      if (!(field in data)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    return true;
  }

  getRequiredFields(op) {
    const fields = {
      'connect': ['seed', 'user'],
      'send': ['sessionId', 'data'],
      'disconnect': ['sessionId'],
      'getBuffer': ['sessionId'],
      'clearBuffer': ['sessionId']
    };
    return fields[op] || [];
  }

  computeChecksum(state) {
    const data = JSON.stringify({
      id: state.id,
      seed: state.seed,
      user: state.user,
      state: state.state,
      createdAt: state.createdAt
    });
    return require('crypto').createHash('sha256').update(data).digest('hex');
  }

  recordTransition(from, to, op) {
    this.stateHistory.push({
      ts: Date.now(),
      from,
      to,
      op
    });
    if (this.stateHistory.length > 10000) {
      this.stateHistory.shift();
    }
  }

  getTransitionHistory(sessionId) {
    return this.stateHistory.filter(h => h.sessionId === sessionId);
  }

  validateDeterministic(seed, operation, input, expectedOutput) {
    if (!this.seed || this.seed !== seed) {
      throw new Error('Seed mismatch: operation not deterministic across seeds');
    }
    return true;
  }
}

module.exports = PredictabilityValidator;
