const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class PluginManager extends EventEmitter {
  constructor(state, config = {}) {
    super();
    this.state = state;
    this.config = config;
    this.plugins = new Map();
    this.hooks = new Map();
    this.middleware = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    this.state.log('PluginManager initializing', 'info');

    const builtinDir = path.join(__dirname, 'builtin');
    if (fs.existsSync(builtinDir)) {
      const plugins = fs.readdirSync(builtinDir);
      for (const plugin of plugins) {
        if (plugin.endsWith('.js')) {
          const name = plugin.replace('.js', '');
          try {
            await this.load(name, path.join(builtinDir, plugin));
            this.state.log(`Loaded plugin: ${name}`, 'info');
          } catch (err) {
            this.state.log(`Failed to load plugin ${name}: ${err.message}`, 'error');
          }
        }
      }
    }

    this.initialized = true;
    this.emit('ready');
  }

  async load(name, modulePath) {
    if (this.plugins.has(name)) {
      throw new Error(`Plugin ${name} already loaded`);
    }

    try {
      const Module = require(modulePath);
      const instance = typeof Module === 'function' ? new Module(this.state) : Module;

      if (!instance.name) instance.name = name;
      if (!instance.version) instance.version = '1.0.0';

      if (instance.hooks) {
        for (const [hookName, handler] of Object.entries(instance.hooks)) {
          this.registerHook(hookName, handler.bind(instance));
        }
      }

      if (instance.middleware) {
        this.middleware.push(...(Array.isArray(instance.middleware) ? instance.middleware : [instance.middleware]));
      }

      this.plugins.set(name, instance);
      this.emit('plugin:loaded', { name, instance });
      return instance;
    } catch (err) {
      throw new Error(`Failed to load plugin ${name}: ${err.message}`);
    }
  }

  unload(name) {
    if (!this.plugins.has(name)) {
      throw new Error(`Plugin ${name} not found`);
    }

    const plugin = this.plugins.get(name);
    if (plugin.unload && typeof plugin.unload === 'function') {
      plugin.unload();
    }

    this.plugins.delete(name);
    this.emit('plugin:unloaded', { name });
  }

  registerHook(hookName, handler) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }
    this.hooks.get(hookName).push(handler);
  }

  async executeHook(hookName, data = {}) {
    const handlers = this.hooks.get(hookName) || [];
    let result = data;
    for (const handler of handlers) {
      try {
        result = await handler(result) || result;
      } catch (err) {
        this.state.log(`Hook ${hookName} error: ${err.message}`, 'error');
        throw err;
      }
    }
    return result;
  }

  getPlugin(name) {
    return this.plugins.get(name);
  }

  listPlugins() {
    return Array.from(this.plugins.values()).map(p => ({
      name: p.name || 'unknown',
      version: p.version || '1.0.0',
      hooks: p.hooks ? Object.keys(p.hooks) : [],
      middleware: !!p.middleware
    }));
  }

  getHooks(hookName) {
    return this.hooks.get(hookName) || [];
  }
}

if (!global.telesshPluginManager) {
  global.telesshPluginManager = null;
}

module.exports = PluginManager;
