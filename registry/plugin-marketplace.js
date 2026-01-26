class PluginMarketplace {
  constructor(registry, config = {}) {
    this.registry = registry;
    this.config = config;
    this.featured = new Map();
    this.categories = new Map();
    this.ratings = new Map();
    this.seed = config.seed || 'marketplace-default';
    this.initDefaultCategories();
  }

  initDefaultCategories() {
    const categories = ['core', 'networking', 'storage', 'logging', 'validation', 'security', 'ui'];
    for (const cat of categories) {
      this.categories.set(cat, []);
    }
  }

  addToCategory(category, pluginName) {
    if (!this.categories.has(category)) {
      this.categories.set(category, []);
    }
    const plugins = this.categories.get(category);
    if (!plugins.includes(pluginName)) {
      plugins.push(pluginName);
    }
  }

  removeFromCategory(category, pluginName) {
    if (this.categories.has(category)) {
      const plugins = this.categories.get(category);
      const idx = plugins.indexOf(pluginName);
      if (idx >= 0) plugins.splice(idx, 1);
    }
  }

  getCategory(category) {
    const plugins = this.categories.get(category) || [];
    return plugins.map(name => this.registry.get(name)).filter(p => p);
  }

  setRating(pluginName, rating) {
    if (rating < 0 || rating > 5) {
      throw new Error('Rating must be between 0 and 5');
    }
    if (!this.registry.get(pluginName)) {
      throw new Error(`Plugin ${pluginName} not found`);
    }
    this.ratings.set(pluginName, rating);
  }

  getRating(pluginName) {
    return this.ratings.get(pluginName) || 0;
  }

  getFeatured() {
    return Array.from(this.featured.values()).map(name =>
      Object.assign({}, this.registry.get(name), { rating: this.getRating(name) })
    ).filter(p => p.name);
  }

  feature(pluginName) {
    if (!this.registry.get(pluginName)) {
      throw new Error(`Plugin ${pluginName} not found`);
    }
    this.featured.set(pluginName, pluginName);
  }

  unfeature(pluginName) {
    this.featured.delete(pluginName);
  }

  discover(filters = {}) {
    let results = this.registry.list();

    if (filters.category) {
      const categoryPlugins = this.categories.get(filters.category) || [];
      results = results.filter(p => categoryPlugins.includes(p.name));
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();
      results = results.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    }

    if (filters.minRating) {
      results = results.filter(p => this.getRating(p.name) >= filters.minRating);
    }

    if (filters.sort === 'rating') {
      results.sort((a, b) => this.getRating(b.name) - this.getRating(a.name));
    }

    if (filters.sort === 'name') {
      results.sort((a, b) => a.name.localeCompare(b.name));
    }

    return results;
  }

  export() {
    return {
      seed: this.seed,
      featured: Array.from(this.featured.values()),
      categories: Array.from(this.categories.entries()),
      ratings: Array.from(this.ratings.entries())
    };
  }

  import(data) {
    if (data.seed !== this.seed) {
      throw new Error('Seed mismatch during marketplace import');
    }
    for (const name of data.featured) {
      if (!this.featured.has(name)) {
        this.featured.set(name, name);
      }
    }
    for (const [cat, plugins] of data.categories) {
      if (!this.categories.has(cat)) {
        this.categories.set(cat, []);
      }
      for (const plugin of plugins) {
        if (!this.categories.get(cat).includes(plugin)) {
          this.categories.get(cat).push(plugin);
        }
      }
    }
    for (const [name, rating] of data.ratings) {
      if (!this.ratings.has(name)) {
        this.ratings.set(name, rating);
      }
    }
  }
}

module.exports = PluginMarketplace;
