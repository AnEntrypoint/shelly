const AtomicSkill = require('./skill');

function execute(args = {}) {
  const { seed, command, args: cmdArgs = {} } = args;

  if (!seed) {
    return { status: 'error', error: 'seed required' };
  }

  if (!command) {
    return { status: 'error', error: 'command required' };
  }

  return AtomicSkill.execute(seed, command, cmdArgs);
}

module.exports = {
  execute,
  AtomicSkill
};
