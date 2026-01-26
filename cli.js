#!/usr/bin/env node

const AtomicSkill = require('./skill/skill');
const path = require('path');
const fs = require('fs');

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
    } else if (!args._cmd) {
      args._cmd = argv[i];
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
    console.error('Usage: shelly <command> [--seed <id>] [options]');
    console.error('Commands:');
    console.error('  connect --seed <id>');
    console.error('  send --text "<text>"');
    console.error('  receive');
    console.error('  status');
    console.error('  disconnect');
    console.error('  serve --seed <id> [--port <port>]');
    console.error('  stop');
    process.exit(1);
  }

  // For connect and serve, seed is required from CLI
  if ((cmd === 'connect' || cmd === 'serve') && !seed) {
    console.error('Error: --seed required for ' + cmd + ' command');
    process.exit(1);
  }

  // For other commands, use provided seed or read from current-seed file
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
        commandArgs = { text: args.text };
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
        commandArgs = { port: args.port || null };
        break;
      case 'stop':
        commandArgs = {};
        break;
    }

    const result = await AtomicSkill.execute(seed, cmd, commandArgs);

    // After successful connect or serve, set current seed
    if ((cmd === 'connect' || cmd === 'serve') && result.status === 'success') {
      setCurrentSeed(seed);
    }

    // After successful disconnect or stop, clear current seed
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
