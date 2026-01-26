const EventEmitter = require('events');

class State {
  constructor() {
    this.sessions = new Map();
    this.logs = [];
    this.events = new EventEmitter();
    this.config = {
      maxLogSize: 10000,
      logRetention: 1000,
      sessionTimeout: 0,
      autoPersist: true
    };
  }

  createSession(id, seed, user) {
    const session = {
      id,
      seed,
      user,
      connection: null,
      state: 'disconnected',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      buffer: [],
      errors: []
    };
    this.sessions.set(id, session);
    this.events.emit('session:created', session);
    return session;
  }

  getSession(id) {
    return this.sessions.get(id);
  }

  deleteSession(id) {
    const session = this.sessions.get(id);
    if (session) {
      this.sessions.delete(id);
      this.events.emit('session:deleted', session);
    }
    return session;
  }

  log(msg, level = 'info') {
    const entry = {
      ts: Date.now(),
      level,
      msg,
      session: null
    };
    this.logs.push(entry);
    if (this.logs.length > this.config.maxLogSize) {
      this.logs.shift();
    }
    this.events.emit('log', entry);
    return entry;
  }

  getLogs(filter = {}) {
    let result = this.logs;
    if (filter.level) {
      result = result.filter(e => e.level === filter.level);
    }
    if (filter.since) {
      result = result.filter(e => e.ts >= filter.since);
    }
    return result;
  }

  clearLogs() {
    const count = this.logs.length;
    this.logs = [];
    this.events.emit('logs:cleared', { count });
    return count;
  }

  reset() {
    this.sessions.clear();
    this.logs = [];
    this.events.emit('state:reset');
  }
}

if (!global.telesshState) {
  global.telesshState = new State();
}

module.exports = global.telesshState;
