#!/usr/bin/env node

const { execute } = require('./skill/index');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      let value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        try {
          args[key] = JSON.parse(value);
        } catch {
          args[key] = value;
        }
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function formatOutput(result) {
  if (result.status === 'error') {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
const { seed, cmd, args: cmdArgs = {} } = args;

if (!seed) {
  console.error('Error: --seed required');
  process.exit(1);
}

if (!cmd) {
  console.error('Error: --cmd required');
  process.exit(1);
}

const result = execute({
  seed,
  command: cmd,
  args: typeof cmdArgs === 'string' ? JSON.parse(cmdArgs) : cmdArgs
});

formatOutput(result);
