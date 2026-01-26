const state = require('../state');
const server = require('../server');
const proc = require('../process');
const { userInfo } = require('os');

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
        case 'send':
          result = this.send(ctx, args);
          break;
        case 'receive':
          result = this.receive(ctx);
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
    const info = proc.connect(ctx.seed);
    ctx.connected = true;
    ctx.hypersshSeed = ctx.seed;
    ctx.user = info.user;
    ctx.connectedAt = Date.now();
    ctx.procPid = null;
    return {
      status: 'success',
      message: 'Connected',
      seed: ctx.seed,
      user: ctx.user
    };
  }

  static send(ctx, args) {
    if (!ctx.connected) {
      throw new Error('Not connected. Call connect first');
    }
    const { text } = args;
    if (!text) throw new Error('text required');

    proc.send(ctx.seed, text);
    const data = proc.receive(ctx.seed);
    return {
      status: 'success',
      message: 'Sent and received',
      seed: ctx.seed,
      command: text,
      output: data
    };
  }

  static receive(ctx) {
    if (!ctx.connected) {
      throw new Error('Not connected. Call connect first');
    }
    const data = proc.receive(ctx.seed);
    return {
      status: 'success',
      message: 'Received',
      seed: ctx.seed,
      data
    };
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
    if (ctx.connected) {
      proc.disconnect(ctx.seed);
    }
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
    let { port } = args;
    if (ctx.serving && ctx.serverPid) throw new Error('Already serving on this seed');

    if (!port) {
      port = 9000 + Math.floor(Math.random() * 1000);
    }

    const user = userInfo().username;
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
      pid: info.pid,
      connectWith: `shelly connect --seed ${ctx.seed}`
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
