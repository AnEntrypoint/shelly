const state = require('../state');
const { execSync } = require('child_process');
const server = require('../server');

class AtomicSkill {
  static execute(seed, command, args = {}) {
    if (!seed) throw new Error('seed required');
    if (!command) throw new Error('command required');

    const ctx = state.get(seed);
    ctx.lastCmd = { command, args, ts: Date.now() };

    try {
      let result;
      switch (command) {
        case 'connect':
          result = this.connect(ctx, args);
          break;
        case 'exec':
          result = this.exec(ctx, args);
          break;
        case 'status':
          result = this.status(ctx);
          break;
        case 'disconnect':
          result = this.disconnect(ctx);
          break;
        case 'serve':
          result = this.serve(ctx, args);
          break;
        case 'stop':
          result = this.stopServing(ctx);
          break;
        default:
          throw new Error(`Unknown command: ${command}`);
      }
      state.save(seed);
      return result;
    } catch (err) {
      return { status: 'error', error: err.message, seed, command };
    }
  }

  static connect(ctx, args) {
    const { hypersshSeed, user } = args;
    if (!hypersshSeed || !user) {
      throw new Error('hypersshSeed and user required');
    }
    ctx.connected = true;
    ctx.hypersshSeed = hypersshSeed;
    ctx.user = user;
    ctx.connectedAt = Date.now();
    return {
      status: 'success',
      message: 'Connected',
      seed: ctx.seed,
      hypersshSeed,
      user
    };
  }

  static exec(ctx, args) {
    if (!ctx.connected) {
      throw new Error('Not connected. Call connect first');
    }
    const { command } = args;
    if (!command) throw new Error('command required');

    try {
      const output = execSync(`npx hyperssh -s ${ctx.hypersshSeed} -u ${ctx.user} -e "${command}"`, {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      return {
        status: 'success',
        message: 'Command executed',
        seed: ctx.seed,
        command,
        hypersshSeed: ctx.hypersshSeed,
        output: output.trim()
      };
    } catch (err) {
      throw new Error(`Command failed: ${err.message}`);
    }
  }

  static status(ctx) {
    const result = {
      status: 'success',
      seed: ctx.seed,
      createdAt: new Date(ctx.createdAt).toISOString(),
      lastCmd: ctx.lastCmd
    };

    if (ctx.serving) {
      result.serving = true;
      result.serverPort = ctx.serverPort;
      result.serverPid = ctx.serverPid;
      result.user = ctx.user;
    } else {
      result.connected = ctx.connected;
      result.hypersshSeed = ctx.hypersshSeed;
      result.user = ctx.user;
      result.connectedAt = ctx.connectedAt ? new Date(ctx.connectedAt).toISOString() : null;
    }

    return result;
  }

  static disconnect(ctx) {
    ctx.connected = false;
    ctx.hypersshSeed = null;
    ctx.user = null;
    return {
      status: 'success',
      message: 'Disconnected',
      seed: ctx.seed
    };
  }

  static serve(ctx, args) {
    const { port, user } = args;
    if (!port || !user) throw new Error('port and user required');
    if (ctx.serving && ctx.serverPid) throw new Error('Already serving on this seed');

    const info = server.start(ctx.seed, port, user);
    ctx.serving = true;
    ctx.serverPort = port;
    ctx.serverPid = info.pid;
    ctx.user = user;
    server.restore(ctx.seed, info.pid, port, user);

    return {
      status: 'success',
      message: 'Server started',
      seed: ctx.seed,
      port,
      user,
      pid: info.pid
    };
  }

  static stopServing(ctx) {
    if (!ctx.serving || !ctx.serverPid) {
      throw new Error('No server running');
    }

    server.stop(ctx.serverPid);
    ctx.serving = false;
    ctx.serverPort = null;
    ctx.serverPid = null;

    return {
      status: 'success',
      message: 'Server stopped',
      seed: ctx.seed
    };
  }
}

module.exports = AtomicSkill;
