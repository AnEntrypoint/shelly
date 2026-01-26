const state = require('../state');

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
        case 'send':
          result = this.send(ctx, args);
          break;
        case 'status':
          result = this.status(ctx);
          break;
        case 'export':
          result = this.exportState(ctx);
          break;
        case 'import':
          result = this.importState(ctx, args);
          break;
        case 'disconnect':
          result = this.disconnect(ctx);
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

    return {
      status: 'success',
      message: 'Command executed',
      seed: ctx.seed,
      command,
      hypersshSeed: ctx.hypersshSeed,
      output: `Executed on ${ctx.hypersshSeed}: ${command}`
    };
  }

  static send(ctx, args) {
    if (!ctx.connected) throw new Error('Not connected');
    const { data } = args;
    if (!data) throw new Error('data required');
    return {
      status: 'success',
      message: 'Data sent',
      seed: ctx.seed,
      bytes: data.length
    };
  }

  static status(ctx) {
    return {
      status: 'success',
      seed: ctx.seed,
      connected: ctx.connected,
      hypersshSeed: ctx.hypersshSeed,
      user: ctx.user,
      createdAt: new Date(ctx.createdAt).toISOString(),
      connectedAt: ctx.connectedAt ? new Date(ctx.connectedAt).toISOString() : null,
      lastCmd: ctx.lastCmd
    };
  }

  static exportState(ctx) {
    return {
      status: 'success',
      seed: ctx.seed,
      data: JSON.stringify(ctx)
    };
  }

  static importState(ctx, args) {
    const { data } = args;
    if (!data) throw new Error('data required');
    const imported = JSON.parse(data);
    if (imported.seed !== ctx.seed) {
      throw new Error(`Seed mismatch on import: ${imported.seed} !== ${ctx.seed}`);
    }
    Object.assign(ctx, imported);
    return {
      status: 'success',
      message: 'State imported',
      seed: ctx.seed
    };
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
}

module.exports = AtomicSkill;
