module.exports = class SessionPlugin {
  constructor(state) {
    this.state = state;
    this.name = 'session';
    this.version = '1.0.0';
    this.hooks = {
      'session:pre-connect': this.validateSeed.bind(this),
      'session:post-connect': this.recordConnection.bind(this),
      'session:pre-send': this.validateState.bind(this),
      'session:post-send': this.recordActivity.bind(this),
      'session:pre-disconnect': this.cleanup.bind(this)
    };
  }

  async validateSeed(data) {
    const { seed, user } = data;
    if (!seed || typeof seed !== 'string' || seed.length === 0) {
      throw new Error('Invalid seed: must be non-empty string');
    }
    if (!user || typeof user !== 'string' || user.length === 0) {
      throw new Error('Invalid user: must be non-empty string');
    }
    return data;
  }

  async recordConnection(data) {
    const { sessionId } = data;
    this.state.log(`Session ${sessionId} connection recorded`, 'info');
    return data;
  }

  async validateState(data) {
    const { sessionId } = data;
    const session = this.state.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.state !== 'connected') {
      throw new Error(`Session ${sessionId} not in connected state`);
    }
    return data;
  }

  async recordActivity(data) {
    const { sessionId } = data;
    const session = this.state.getSession(sessionId);
    if (session) session.lastActivity = Date.now();
    return data;
  }

  async cleanup(data) {
    const { sessionId } = data;
    this.state.log(`Cleaning up session ${sessionId}`, 'info');
    return data;
  }
};
