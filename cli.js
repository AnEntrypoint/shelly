#!/usr/bin/env node

const readline = require('readline');
const state = require('./state');
const SessionManager = require('./session');

class CLI {
  constructor() {
    this.rl = null;
    this.currentSession = null;
  }

  async init() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'telessh> '
    });

    global.telesshDebug = {
      state: () => ({
        sessions: Array.from(state.sessions.entries()).map(([k, v]) => [k, {
          seed: v.seed,
          user: v.user,
          state: v.state,
          bufferLines: v.buffer.length,
          errors: v.errors.length
        }]),
        logEntries: state.logs.length,
        currentSession: this.currentSession
      }),
      logs: () => state.logs,
      sessions: () => SessionManager.listSessions(),
      getLogs: (filter) => state.getLogs(filter),
      getSession: (id) => state.getSession(id),
      help: () => this.showHelp()
    };

    this.showWelcome();
    this.prompt();
  }

  showWelcome() {
    console.log('\n=== Telessh - Seeded HyperSSH Connection Manager ===');
    console.log('Type "help" for commands. Access debug via: global.telesshDebug\n');
  }

  showHelp() {
    console.log(`
Commands:
  connect <seed> <user>     - Connect to remote via seed
  send <data>              - Send data to current session
  type <command>           - Type command and execute
  sessions                 - List all sessions
  use <sessionId>          - Switch to session
  logs [filter]            - Show logs
  clear-logs               - Clear all logs
  buffer                   - Show current session buffer
  clear-buffer             - Clear current session buffer
  disconnect               - Disconnect current session
  status                   - Show current session status
  exit                     - Exit CLI
    `);
  }

  prompt() {
    this.rl.prompt();
    this.rl.on('line', (line) => this.handleCommand(line.trim()));
  }

  async handleCommand(input) {
    if (!input) {
      this.rl.prompt();
      return;
    }

    const [cmd, ...args] = input.split(' ');

    try {
      switch (cmd) {
        case 'connect':
          await this.cmdConnect(args);
          break;
        case 'send':
          this.cmdSend(args.join(' '));
          break;
        case 'type':
          this.cmdSend(args.join(' ') + '\n');
          break;
        case 'sessions':
          this.cmdSessions();
          break;
        case 'use':
          this.cmdUse(args[0]);
          break;
        case 'logs':
          this.cmdLogs(args);
          break;
        case 'clear-logs':
          this.cmdClearLogs();
          break;
        case 'buffer':
          this.cmdBuffer();
          break;
        case 'clear-buffer':
          this.cmdClearBuffer();
          break;
        case 'disconnect':
          this.cmdDisconnect();
          break;
        case 'status':
          this.cmdStatus();
          break;
        case 'help':
          this.showHelp();
          break;
        case 'exit':
          this.exit();
          return;
        default:
          console.log(`Unknown command: ${cmd}`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }

    this.rl.prompt();
  }

  async cmdConnect(args) {
    if (args.length < 2) {
      console.log('Usage: connect <seed> <user> [sessionId]');
      return;
    }
    const [seed, user, sessionId] = args;
    const session = await SessionManager.connect(seed, user, { sessionId });
    this.currentSession = session.id;
    console.log(`Connected: ${session.id}`);
  }

  cmdSend(data) {
    if (!this.currentSession) {
      console.log('No active session. Use "connect" or "use" first.');
      return;
    }
    SessionManager.send(this.currentSession, data);
  }

  cmdSessions() {
    const sessions = SessionManager.listSessions();
    if (sessions.length === 0) {
      console.log('No sessions');
      return;
    }
    console.table(sessions);
  }

  cmdUse(sessionId) {
    if (!sessionId) {
      console.log('Usage: use <sessionId>');
      return;
    }
    const session = state.getSession(sessionId);
    if (!session) {
      console.log(`Session ${sessionId} not found`);
      return;
    }
    this.currentSession = sessionId;
    console.log(`Switched to ${sessionId}`);
  }

  cmdLogs(args) {
    const filter = args[0] === 'error' ? { level: 'error' } : {};
    const logs = state.getLogs(filter);
    logs.slice(-50).forEach(log => {
      console.log(`[${new Date(log.ts).toISOString()}] ${log.level}: ${log.msg}`);
    });
  }

  cmdClearLogs() {
    const count = state.clearLogs();
    console.log(`Cleared ${count} log entries`);
  }

  cmdBuffer() {
    if (!this.currentSession) {
      console.log('No active session');
      return;
    }
    const buffer = SessionManager.getBuffer(this.currentSession);
    console.log(buffer || '(empty)');
  }

  cmdClearBuffer() {
    if (!this.currentSession) {
      console.log('No active session');
      return;
    }
    const result = SessionManager.clearBuffer(this.currentSession);
    console.log(`Cleared ${result.cleared} lines`);
  }

  cmdDisconnect() {
    if (!this.currentSession) {
      console.log('No active session');
      return;
    }
    SessionManager.disconnect(this.currentSession);
    this.currentSession = null;
    console.log('Disconnected');
  }

  cmdStatus() {
    if (!this.currentSession) {
      console.log('No active session');
      return;
    }
    const session = state.getSession(this.currentSession);
    console.log(JSON.stringify({
      id: session.id,
      seed: session.seed,
      user: session.user,
      state: session.state,
      createdAt: new Date(session.createdAt),
      lastActivity: new Date(session.lastActivity),
      bufferSize: session.buffer.length,
      errorCount: session.errors.length
    }, null, 2));
  }

  exit() {
    if (this.currentSession) {
      SessionManager.disconnect(this.currentSession);
    }
    this.rl.close();
    console.log('Goodbye!');
    process.exit(0);
  }
}

async function run() {
  const cli = new CLI();
  await cli.init();
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
