const state = require('./state');
const SessionManager = require('./session');

module.exports = {
  state,
  SessionManager,

  connect: (seed, user, opts) => SessionManager.connect(seed, user, opts),
  disconnect: (sessionId) => SessionManager.disconnect(sessionId),
  send: (sessionId, data) => SessionManager.send(sessionId, data),

  getSession: (sessionId) => state.getSession(sessionId),
  listSessions: () => SessionManager.listSessions(),

  getBuffer: (sessionId) => SessionManager.getBuffer(sessionId),
  clearBuffer: (sessionId) => SessionManager.clearBuffer(sessionId),

  getLogs: (filter) => state.getLogs(filter),
  clearLogs: () => state.clearLogs(),

  getState: () => state,
  reset: () => state.reset()
};
