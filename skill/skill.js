const state = require('../state');
const cmd = require('./commands');

class AtomicSkill {
  static async execute(seed, command, args = {}) {
    if (!seed) throw new Error('seed required');
    if (!command) throw new Error('command required');

    const ctx = state.get(seed);
    ctx.lastCmd = { command, args, ts: Date.now() };

    try {
      let result;
      switch (command) {
        case 'connect':
          result = await cmd.connect(ctx, args);
          break;
        case 'send':
          result = await cmd.send(ctx, args);
          break;
        case 'receive':
          result = cmd.receive(ctx);
          break;
        case 'status':
          result = await cmd.status(ctx);
          break;
        case 'disconnect':
          result = await cmd.disconnect(ctx);
          break;
        case 'serve':
          result = cmd.serve(ctx, args);
          break;
        case 'stop':
          result = cmd.stopServing(ctx);
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
}

module.exports = AtomicSkill;
