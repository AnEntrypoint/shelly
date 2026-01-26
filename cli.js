#!/usr/bin/env node

const SessionRepl = require('./repl');
const state = require('./state');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        args[key] = value;
        i++;
      } else {
        args[key] = true;
      }
    } else if (!args._mode) {
      args._mode = argv[i];
    }
  }
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const mode = args._mode || 'serve';
  const seed = args.seed;

  if (!seed) {
    console.error('Error: --seed required');
    console.error('Usage:');
    console.error('  shelly serve --seed <id>      # Interactive session');
    console.error('  shelly connect --seed <id>    # Quick connect and close');
    process.exit(1);
  }

  if (mode === 'serve') {
    const repl = new SessionRepl(seed);
    await repl.start();
  } else if (mode === 'connect') {
    const ctx = state.get(seed);
    console.log(`Session: ${seed}`);
    console.log(`Connected: ${ctx.connected}`);
    if (ctx.connected) {
      console.log(`Host: ${ctx.hypersshSeed}`);
      console.log(`User: ${ctx.user}`);
    }
  } else {
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});