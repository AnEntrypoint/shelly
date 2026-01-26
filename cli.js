#!/usr/bin/env node

const AtomicSkill = require('./skill/skill');

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

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const seed = args.seed;
  const cmd = args._cmd;

  if (!seed) {
    console.error('Error: --seed required');
    console.error('Usage: shelly <command> --seed <id> [options]');
    console.error('Commands:');
    console.error('  connect --seed <id> --hypersshSeed <host> --user <user>');
    console.error('  exec --seed <id> --command <cmd>');
    console.error('  status --seed <id>');
    console.error('  disconnect --seed <id>');
    console.error('  export --seed <id>');
    console.error('  import --seed <id> --data <json>');
    process.exit(1);
  }

  if (!cmd) {
    console.error('Error: command required');
    process.exit(1);
  }

  try {
    let commandArgs = {};

    switch (cmd) {
      case 'connect':
        commandArgs = {
          hypersshSeed: args.hypersshSeed,
          user: args.user
        };
        break;
      case 'exec':
        commandArgs = { command: args.command };
        break;
      case 'send':
        commandArgs = { data: args.data };
        break;
      case 'import':
        commandArgs = { data: args.data };
        break;
    }

    const result = AtomicSkill.execute(seed, cmd, commandArgs);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === 'error' ? 1 : 0);
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

main();