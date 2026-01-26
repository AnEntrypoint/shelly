const { spawn } = require('child_process');
const state = require('./state');

class SessionManager {
  static async connect(seed, user, opts = {}) {
    const sessionId = opts.sessionId || `sess_${Date.now()}`;
    const session = state.createSession(sessionId, seed, user);

    const cmd = ['ssh'];
    if (opts.identity) cmd.push('-i', opts.identity);
    if (opts.port) cmd.push('-p', opts.port);
    if (opts.exec) cmd.push('-e', opts.exec);
    if (opts.args) cmd.push(...opts.args);
    cmd.push(`${user}@${seed}`);

    try {
      const proc = spawn('hyperssh', ['-s', seed, '-u', user, ...(opts.args || [])], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        timeout: opts.timeout || 0
      });

      session.connection = {
        pid: proc.pid,
        process: proc,
        write: (data) => proc.stdin.write(data),
        kill: () => proc.kill(),
        isAlive: () => !proc.killed
      };

      session.state = 'connecting';
      state.log(`Session ${sessionId} connecting to ${seed}...`);

      proc.stdout?.on('data', (data) => {
        const msg = data.toString();
        session.buffer.push(msg);
        state.log(msg);
      });

      proc.stderr?.on('data', (data) => {
        const msg = data.toString();
        session.errors.push(msg);
        state.log(msg, 'error');
      });

      proc.on('close', (code) => {
        session.state = 'disconnected';
        state.log(`Session ${sessionId} closed with code ${code}`);
      });

      proc.on('error', (err) => {
        session.errors.push(err.message);
        state.log(err.message, 'error');
      });

      session.state = 'connected';
      session.lastActivity = Date.now();
      state.events.emit('session:connected', session);
      state.log(`Session ${sessionId} connected`, 'info');

      return session;
    } catch (err) {
      session.errors.push(err.message);
      state.log(`Failed to connect: ${err.message}`, 'error');
      throw err;
    }
  }

  static disconnect(sessionId) {
    const session = state.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    if (session.connection && session.connection.isAlive()) {
      session.connection.kill();
    }
    session.state = 'disconnected';
    state.log(`Session ${sessionId} disconnected`);
    return session;
  }

  static send(sessionId, data) {
    const session = state.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (!session.connection?.isAlive()) throw new Error(`Session ${sessionId} not connected`);

    session.connection.write(data);
    session.lastActivity = Date.now();
    state.log(`Sent to ${sessionId}: ${data.slice(0, 100)}`);
    return session;
  }

  static getBuffer(sessionId) {
    const session = state.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.buffer.join('');
  }

  static clearBuffer(sessionId) {
    const session = state.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const count = session.buffer.length;
    session.buffer = [];
    return { cleared: count };
  }

  static listSessions() {
    return Array.from(state.sessions.values()).map(s => ({
      id: s.id,
      seed: s.seed,
      user: s.user,
      state: s.state,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      bufferSize: s.buffer.length,
      errorCount: s.errors.length
    }));
  }
}

module.exports = SessionManager;
