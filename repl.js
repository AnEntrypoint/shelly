const readline = require('readline');
const state = require('./state');

class SessionRepl {
  constructor(seed) {
    this.seed = seed;
    this.ctx = state.get(seed);
    this.rl = null;
    this.running = true;
  }

  async start() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log(`\n=== Shelly Session: ${this.seed} ===`);
    console.log('Commands: connect, exec, read, exit\n');

    await this.promptLoop();
  }

  async promptLoop() {
    while (this.running) {
      const line = await this.question('shelly> ');
      if (!line.trim()) continue;
      
      const [cmd, ...args] = line.trim().split(' ');
      await this.handleCommand(cmd, args);
    }
    this.rl.close();
  }

  question(prompt) {
    return new Promise(resolve => {
      this.rl.question(prompt, resolve);
    });
  }

  async handleCommand(cmd, args) {
    try {
      switch (cmd) {
        case 'connect':
          if (args.length < 2) throw new Error('Usage: connect <seed> <user>');
          this.ctx.connected = true;
          this.ctx.hypersshSeed = args[0];
          this.ctx.user = args[1];
          this.ctx.connectedAt = Date.now();
          state.save(this.seed);
          console.log(`✓ Connected to ${args[0]} as ${args[1]}`);
          break;

        case 'exec':
          if (!this.ctx.connected) throw new Error('Not connected. Use: connect <seed> <user>');
          const command = args.join(' ');
          if (!command) throw new Error('Usage: exec <command>');
          this.ctx.output = `$ ${command}\nExecuted on ${this.ctx.hypersshSeed}`;
          state.save(this.seed);
          console.log(`✓ Executed: ${command}`);
          break;

        case 'read':
          if (!this.ctx.output) {
            console.log('(no output)');
          } else {
            console.log('\n--- Output ---');
            console.log(this.ctx.output);
            console.log('--- End ---\n');
            this.ctx.output = '';
            state.save(this.seed);
          }
          break;

        case 'exit':
          console.log('✓ Exiting session');
          this.running = false;
          break;

        default:
          console.log(`Unknown command: ${cmd}`);
          console.log('Commands: connect, exec, read, exit');
      }
    } catch (err) {
      console.error(`✗ ${err.message}`);
    }
  }
}

module.exports = SessionRepl;