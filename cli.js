#!/usr/bin/env node

const AtomicSkill = require('./skill/skill');
const path = require('path');
const fs = require('fs');

function parseArgs(argv) {
  const args = {};
  let positionalIndex = 0;
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
    } else if (positionalIndex === 0) {
      args._cmd = argv[i];
      positionalIndex++;
    } else if (positionalIndex === 1) {
      args._positional = argv[i];
      positionalIndex++;
    }
  }
  return args;
}

function getCurrentSeed() {
  const seedFile = path.join(process.env.HOME, '.shelly', 'current-seed');
  if (!fs.existsSync(seedFile)) return null;
  return fs.readFileSync(seedFile, 'utf-8').trim();
}

function setCurrentSeed(seed) {
  const seedFile = path.join(process.env.HOME, '.shelly', 'current-seed');
  const dir = path.dirname(seedFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(seedFile, seed);
}

function clearCurrentSeed() {
  const seedFile = path.join(process.env.HOME, '.shelly', 'current-seed');
  if (fs.existsSync(seedFile)) fs.unlinkSync(seedFile);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  let seed = args.seed;
  const cmd = args._cmd;

  if (!cmd) {
    console.error('Error: command required');
    console.error('Usage: npx -y gxe@latest AnEntrypoint/shelly cli <command> [--seed <id>] [options]');
    console.error('');
    console.error('Commands:');
    console.error('  npx -y gxe@latest AnEntrypoint/shelly cli connect --seed <id>');
    console.error('  npx -y gxe@latest AnEntrypoint/shelly cli send --text "<text>"');
    console.error('  npx -y gxe@latest AnEntrypoint/shelly cli receive');
    console.error('  npx -y gxe@latest AnEntrypoint/shelly cli status');
    console.error('  npx -y gxe@latest AnEntrypoint/shelly cli disconnect');
    console.error('  npx -y gxe@latest AnEntrypoint/shelly cli serve --seed <id> [--port <port>]');
    console.error('  npx -y gxe@latest AnEntrypoint/shelly cli stop');
    process.exit(1);
  }

  if ((cmd === 'connect' || cmd === 'serve') && !seed) {
    console.error('Error: --seed required for ' + cmd + ' command');
    process.exit(1);
  }

  if (!seed && cmd !== 'connect' && cmd !== 'serve') {
    seed = getCurrentSeed();
  }

  if (!seed) {
    console.error('Error: --seed required (or run "connect --seed <id>" first)');
    process.exit(1);
  }

  try {
    let commandArgs = {};

    switch (cmd) {
      case 'connect':
        commandArgs = {};
        break;
      case 'send':
        commandArgs = { text: args.text || args._positional };
        break;
      case 'receive':
        commandArgs = {};
        break;
      case 'status':
        commandArgs = {};
        break;
      case 'disconnect':
        commandArgs = {};
        break;
      case 'serve':
        commandArgs = { port: args.port ? parseInt(args.port, 10) : null };
        break;
      case 'stop':
        commandArgs = {};
        break;
    }

    const result = await AtomicSkill.execute(seed, cmd, commandArgs);

    if ((cmd === 'connect' || cmd === 'serve') && result.status === 'success') {
      setCurrentSeed(seed);
    }

    if ((cmd === 'disconnect' || cmd === 'stop') && result.status === 'success') {
      clearCurrentSeed();
    }

    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === 'error' ? 1 : 0);
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

main();
