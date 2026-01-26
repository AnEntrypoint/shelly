const SessionManager = require('../session');
const PluginManager = require('../plugins/plugin-manager');
const PluginRegistry = require('../registry/plugin-registry');
const PluginMarketplace = require('../registry/plugin-marketplace');
const PredictabilityValidator = require('../validation/predictability-validator');
const state = require('../state');

class TelesshSkill {
  constructor(seed, opts = {}) {
    if (!seed || typeof seed !== 'string') {
      throw new Error('Skill requires seed parameter');
    }
    if (seed.length > 1024) {
      throw new Error('Seed exceeds maximum length of 1024 characters');
    }

    this.seed = seed;
    this.opts = opts;
    this.state = state;
    this.sessionManager = SessionManager;
    this.validator = new PredictabilityValidator({ seed, level: 'strict' });
    this.registry = new PluginRegistry({ seed });
    this.marketplace = new PluginMarketplace(this.registry, { seed });
    this.pluginManager = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    this.state.log(`TelesshSkill initializing with seed: ${this.seed}`, 'info');

    if (!global.telesshPluginManager) {
      this.pluginManager = new PluginManager(this.state, this.opts);
      global.telesshPluginManager = this.pluginManager;
    } else {
      this.pluginManager = global.telesshPluginManager;
    }

    await this.pluginManager.init();

    this.registerBuiltinPlugins();
    this.initialized = true;

    this.state.log('TelesshSkill initialized', 'info');
    return this;
  }

  registerBuiltinPlugins() {
    const builtins = [
      { name: 'session', hooks: true },
      { name: 'buffer', hooks: true },
      { name: 'logging', hooks: true },
      { name: 'validation', hooks: true }
    ];

    for (const plugin of builtins) {
      const instance = this.pluginManager.getPlugin(plugin.name);
      if (instance) {
        this.registry.register(plugin.name, {
          name: plugin.name,
          version: instance.version || '1.0.0',
          description: `Built-in ${plugin.name} plugin`,
          author: 'telessh',
          hooks: plugin.hooks ? instance.hooks || {} : undefined
        });

        this.marketplace.addToCategory('core', plugin.name);
        this.marketplace.setRating(plugin.name, 5);
        this.marketplace.feature(plugin.name);
      }
    }
  }

  async connect(seed, user, opts = {}) {
    if (!this.initialized) await this.init();

    this.validator.validateSeed(seed);
    this.validator.validateOperation('connect', { seed, user });

    const data = { seed, user, sessionId: opts.sessionId };
    await this.pluginManager.executeHook('session:pre-connect', data);

    const session = await this.sessionManager.connect(seed, user, opts);

    await this.pluginManager.executeHook('session:post-connect', { ...data, session });

    return session;
  }

  async send(sessionId, data) {
    if (!this.initialized) await this.init();

    this.validator.validateOperation('send', { sessionId, data });

    const sendData = { sessionId, data };
    await this.pluginManager.executeHook('session:pre-send', sendData);

    const session = this.sessionManager.send(sessionId, data);

    await this.pluginManager.executeHook('session:post-send', { ...sendData, session });

    return session;
  }

  async disconnect(sessionId) {
    if (!this.initialized) await this.init();

    this.validator.validateOperation('disconnect', { sessionId });

    const data = { sessionId };
    await this.pluginManager.executeHook('session:pre-disconnect', data);

    const session = this.sessionManager.disconnect(sessionId);

    return session;
  }

  getBuffer(sessionId) {
    const buffer = this.sessionManager.getBuffer(sessionId);
    return buffer;
  }

  clearBuffer(sessionId) {
    return this.sessionManager.clearBuffer(sessionId);
  }

  listSessions() {
    return this.sessionManager.listSessions();
  }

  listPlugins() {
    return this.pluginManager.listPlugins();
  }

  getRegistry() {
    return {
      list: () => this.registry.list(),
      search: (q) => this.registry.search(q),
      get: (name) => this.registry.get(name),
      install: (name) => this.registry.install(name),
      uninstall: (name) => this.registry.uninstall(name),
      isInstalled: (name) => this.registry.isInstalled(name)
    };
  }

  getMarketplace() {
    return {
      discover: (filters) => this.marketplace.discover(filters),
      featured: () => this.marketplace.getFeatured(),
      categories: () => Array.from(this.marketplace.categories.keys()),
      category: (cat) => this.marketplace.getCategory(cat),
      search: (q) => this.marketplace.discover({ search: q })
    };
  }

  getValidator() {
    return this.validator;
  }

  getState() {
    return {
      sessions: this.state.listSessions ? this.state.listSessions() : [],
      logs: this.state.logs || [],
      config: this.state.config || {}
    };
  }

  async loadPlugin(name, modulePath) {
    return this.pluginManager.load(name, modulePath);
  }

  unloadPlugin(name) {
    return this.pluginManager.unload(name);
  }

  async executeHook(hookName, data) {
    return this.pluginManager.executeHook(hookName, data);
  }

  exportState() {
    return {
      seed: this.seed,
      sessions: this.listSessions(),
      plugins: this.listPlugins(),
      registry: this.registry.export(),
      marketplace: this.marketplace.export()
    };
  }

  async importState(data) {
    if (data.seed !== this.seed) {
      throw new Error('Seed mismatch on import');
    }
    this.registry.import(data.registry);
    this.marketplace.import(data.marketplace);
  }
}

module.exports = TelesshSkill;
