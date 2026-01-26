const TelesshSkill = require('./skill');

let skillInstance = null;

async function execute(args = {}) {
  const { seed = 'default', command, params = {} } = args;

  if (!seed) {
    throw new Error('Seed parameter required for telessh skill');
  }

  if (!skillInstance || skillInstance.seed !== seed) {
    skillInstance = new TelesshSkill(seed);
    await skillInstance.init();
  }

  if (!command) {
    return {
      status: 'ready',
      seed: seed,
      instance: skillInstance,
      commands: [
        'connect', 'send', 'disconnect', 'getBuffer', 'clearBuffer',
        'listSessions', 'listPlugins', 'loadPlugin', 'unloadPlugin',
        'getRegistry', 'getMarketplace', 'getValidator', 'getState',
        'executeHook', 'exportState', 'importState'
      ]
    };
  }

  try {
    switch (command) {
      case 'connect':
        return await skillInstance.connect(params.seed, params.user, params.opts);

      case 'send':
        return await skillInstance.send(params.sessionId, params.data);

      case 'disconnect':
        return await skillInstance.disconnect(params.sessionId);

      case 'getBuffer':
        return skillInstance.getBuffer(params.sessionId);

      case 'clearBuffer':
        return skillInstance.clearBuffer(params.sessionId);

      case 'listSessions':
        return skillInstance.listSessions();

      case 'listPlugins':
        return skillInstance.listPlugins();

      case 'loadPlugin':
        return await skillInstance.loadPlugin(params.name, params.modulePath);

      case 'unloadPlugin':
        return skillInstance.unloadPlugin(params.name);

      case 'getRegistry':
        return skillInstance.getRegistry();

      case 'getMarketplace':
        return skillInstance.getMarketplace();

      case 'getValidator':
        return skillInstance.getValidator();

      case 'getState':
        return skillInstance.getState();

      case 'executeHook':
        return await skillInstance.executeHook(params.hookName, params.data);

      case 'exportState':
        return skillInstance.exportState();

      case 'importState':
        return await skillInstance.importState(params.data);

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (err) {
    return {
      status: 'error',
      error: err.message,
      command: command,
      seed: seed
    };
  }
}

module.exports = {
  execute,
  TelesshSkill,
  getInstance: () => skillInstance,
  getSkillForSeed: (seed) => {
    if (!skillInstance || skillInstance.seed !== seed) {
      return null;
    }
    return skillInstance;
  }
};
