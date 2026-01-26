class PluginRegistry {
  constructor(config = {}) {
    this.config = config;
    this.registry = new Map();
    this.installed = new Map();
    this.metadata = new Map();
    this.seed = config.seed || 'registry-default';
  }

  register(name, descriptor) {
    if (this.registry.has(name)) {
      throw new Error(`Plugin ${name} already registered`);
    }

    this.validateDescriptor(descriptor);
    this.registry.set(name, descriptor);
    this.metadata.set(name, {
      registered: Date.now(),
      seed: this.seed,
      version: descriptor.version
    });
    return descriptor;
  }

  validateDescriptor(descriptor) {
    if (!descriptor.name || typeof descriptor.name !== 'string') {
      throw new Error('Plugin must have name');
    }
    if (!descriptor.version || typeof descriptor.version !== 'string') {
      throw new Error('Plugin must have version');
    }
    if (!descriptor.hooks && !descriptor.middleware) {
      throw new Error('Plugin must provide hooks or middleware');
    }
  }

  get(name) {
    return this.registry.get(name);
  }

  list() {
    return Array.from(this.registry.values()).map(p => ({
      name: p.name,
      version: p.version,
      description: p.description || '',
      author: p.author || 'unknown',
      hooks: Object.keys(p.hooks || {}),
      middleware: !!p.middleware
    }));
  }

  search(query) {
    const q = query.toLowerCase();
    return this.list().filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  }

  install(name) {
    const plugin = this.registry.get(name);
    if (!plugin) throw new Error(`Plugin ${name} not found in registry`);

    this.installed.set(name, {
      installed: Date.now(),
      seed: this.seed,
      version: plugin.version
    });

    return plugin;
  }

  uninstall(name) {
    if (!this.installed.has(name)) {
      throw new Error(`Plugin ${name} not installed`);
    }
    this.installed.delete(name);
  }

  isInstalled(name) {
    return this.installed.has(name);
  }

  getInstalledPlugins() {
    return Array.from(this.installed.keys());
  }

  getMetadata(name) {
    return this.metadata.get(name);
  }

  export() {
    return {
      seed: this.seed,
      registered: Array.from(this.registry.entries()).map(([k, v]) => [k, v]),
      installed: Array.from(this.installed.entries()).map(([k, v]) => [k, v])
    };
  }

  import(data) {
    if (data.seed !== this.seed) {
      throw new Error('Seed mismatch during import');
    }
    for (const [name, descriptor] of data.registered) {
      if (!this.registry.has(name)) {
        this.register(name, descriptor);
      }
    }
    for (const [name] of data.installed) {
      this.installed.set(name, data.installed[name]);
    }
  }
}

module.exports = PluginRegistry;
