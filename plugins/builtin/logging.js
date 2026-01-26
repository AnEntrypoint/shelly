module.exports = class LoggingPlugin {
  constructor(state) {
    this.state = state;
    this.name = 'logging';
    this.version = '1.0.0';
    this.sessionLogs = new Map();
    this.hooks = {
      'session:created': this.initSessionLogs.bind(this),
      'session:deleted': this.deleteSessionLogs.bind(this),
      'log:entry': this.recordLog.bind(this)
    };
  }

  async initSessionLogs(data) {
    const { id } = data;
    this.sessionLogs.set(id, []);
    return data;
  }

  async deleteSessionLogs(data) {
    const { id } = data;
    this.sessionLogs.delete(id);
    return data;
  }

  async recordLog(data) {
    const { sessionId, level, msg } = data;
    const entry = { ts: Date.now(), level, msg };
    if (!this.sessionLogs.has(sessionId)) {
      this.sessionLogs.set(sessionId, []);
    }
    this.sessionLogs.get(sessionId).push(entry);
    return data;
  }

  getSessionLogs(sessionId) {
    return this.sessionLogs.get(sessionId) || [];
  }

  clearSessionLogs(sessionId) {
    this.sessionLogs.set(sessionId, []);
  }
};
