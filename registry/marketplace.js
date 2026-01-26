class MarketplaceValidation {
  static validatePluginName(name) {
    if (!name || typeof name !== 'string') throw new Error('Plugin name required');
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Plugin name must be lowercase alphanumeric with hyphens');
    if (name.length < 2 || name.length > 100) throw new Error('Plugin name must be 2-100 characters');
  }

  static validateVersion(version) {
    if (!version || typeof version !== 'string') throw new Error('Version required');
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error('Version must follow semver format');
  }

  static validateRating(rating) {
    if (typeof rating !== 'number') throw new Error('Rating must be a number');
    if (rating < 0 || rating > 5) throw new Error('Rating must be 0-5');
    if ((rating * 2) % 1 !== 0) throw new Error('Rating must increment by 0.5');
  }

  static validateCategory(category, validCategories) {
    if (!validCategories.includes(category)) {
      throw new Error(`Category must be one of: ${validCategories.join(', ')}`);
    }
  }

  static validateMetadata(metadata, validCategories) {
    if (!metadata.name) throw new Error('Metadata must have name');
    if (!metadata.version) throw new Error('Metadata must have version');
    if (!metadata.category) throw new Error('Metadata must have category');
    if (!metadata.author) throw new Error('Metadata must have author');
    if (!metadata.description) throw new Error('Metadata must have description');

    this.validatePluginName(metadata.name);
    this.validateVersion(metadata.version);
    this.validateCategory(metadata.category, validCategories);

    if (metadata.author.length < 2) throw new Error('Author must be at least 2 characters');
    if (metadata.description.length < 10) throw new Error('Description must be at least 10 characters');
    if (metadata.keywords && !Array.isArray(metadata.keywords)) throw new Error('Keywords must be array');
    if (metadata.dependencies && typeof metadata.dependencies !== 'object') throw new Error('Dependencies must be object');
  }

  static validateReview(review) {
    if (!review.author || review.author.length < 2) throw new Error('Review author required');
    if (typeof review.rating !== 'number') throw new Error('Review rating required');
    this.validateRating(review.rating);
    if (!review.text || review.text.length < 5) throw new Error('Review text must be at least 5 characters');
  }
}

class PluginMarketplace {
  constructor(registry, config = {}) {
    this.registry = registry;
    this.config = config;
    this.plugins = new Map();
    this.categories = new Map();
    this.reviews = new Map();
    this.ratings = new Map();
    this.downloads = new Map();
    this.featured = new Set();
    this.trending = new Set();
    this.versions = new Map();
    this.installed = new Set();
    this.seed = config.seed || 'marketplace-default';
    this.validCategories = [
      'core', 'networking', 'storage', 'logging', 'validation', 'security', 'ui', 'observability'
    ];
    this.initCategories();
    if (config.indexData) {
      this.loadFromIndex(config.indexData);
    }
  }

  initCategories() {
    for (const cat of this.validCategories) {
      this.categories.set(cat, new Set());
    }
  }

  loadFromIndex(indexData) {
    if (!indexData.marketplace || !indexData.marketplace.plugins) return;
    for (const [name, pluginData] of Object.entries(indexData.marketplace.plugins)) {
      this.plugins.set(name, pluginData);
      this.categories.get(pluginData.category).add(name);
      this.downloads.set(name, pluginData.downloads || 0);
      this.ratings.set(name, {
        sum: (pluginData.rating || 0) * (pluginData.reviews_count || 1),
        count: pluginData.reviews_count || 0,
        average: pluginData.rating || 0
      });
      this.reviews.set(name, []);
      this.versions.set(name, [{ ...pluginData }]);
      if (pluginData.featured) this.featured.add(name);
    }
    this.updateTrending();
  }

  registerPlugin(name, metadata) {
    MarketplaceValidation.validateMetadata(metadata, this.validCategories);

    if (this.plugins.has(name)) {
      throw new Error(`Plugin ${name} already registered`);
    }

    const pluginEntry = {
      name: metadata.name,
      version: metadata.version,
      author: metadata.author,
      description: metadata.description,
      category: metadata.category,
      keywords: metadata.keywords || [],
      repository: metadata.repository || '',
      license: metadata.license || 'MIT',
      homepage: metadata.homepage || '',
      hooks: metadata.hooks || {},
      middleware: metadata.middleware || false,
      dependencies: metadata.dependencies || {},
      conflicts: metadata.conflicts || [],
      engine: metadata.engine || '>=14.0.0',
      tags: metadata.tags || [],
      created_at: Date.now(),
      updated_at: Date.now(),
      downloads: 0,
      rating: 0,
      reviews_count: 0
    };

    this.plugins.set(name, pluginEntry);
    this.categories.get(metadata.category).add(name);
    this.downloads.set(name, 0);
    this.ratings.set(name, { sum: 0, count: 0, average: 0 });
    this.reviews.set(name, []);
    this.versions.set(name, [{ ...pluginEntry }]);

    return pluginEntry;
  }

  unregisterPlugin(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin ${name} not found`);
    this.categories.get(plugin.category).delete(name);
    this.plugins.delete(name);
    this.featured.delete(name);
    this.trending.delete(name);
    this.reviews.delete(name);
    this.ratings.delete(name);
    this.downloads.delete(name);
    this.versions.delete(name);
  }

  getPluginDetail(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin ${name} not found`);
    const ratingData = this.ratings.get(name);
    return {
      ...plugin,
      rating: ratingData.average,
      reviews_count: ratingData.count,
      downloads: this.downloads.get(name),
      featured: this.featured.has(name),
      trending: this.trending.has(name),
      installed: this.installed.has(name)
    };
  }

  addReview(pluginName, review) {
    if (!this.plugins.has(pluginName)) {
      throw new Error(`Plugin ${pluginName} not found`);
    }
    MarketplaceValidation.validateReview(review);

    const reviewEntry = {
      ...review,
      id: Math.random().toString(36).substr(2, 9),
      created_at: Date.now(),
      updated_at: Date.now(),
      helpful_count: 0
    };

    let pluginReviews = this.reviews.get(pluginName);
    if (!pluginReviews) {
      pluginReviews = [];
      this.reviews.set(pluginName, pluginReviews);
    }
    pluginReviews.push(reviewEntry);

    const ratingData = this.ratings.get(pluginName);
    ratingData.sum += review.rating;
    ratingData.count += 1;
    ratingData.average = Number((ratingData.sum / ratingData.count).toFixed(2));

    const plugin = this.plugins.get(pluginName);
    plugin.reviews_count = ratingData.count;
    plugin.rating = ratingData.average;
    plugin.updated_at = Date.now();

    return reviewEntry;
  }

  getReviews(pluginName, limit = 10) {
    const reviews = this.reviews.get(pluginName) || [];
    return reviews.slice(-limit).reverse();
  }

  recordDownload(pluginName) {
    if (!this.plugins.has(pluginName)) {
      throw new Error(`Plugin ${pluginName} not found`);
    }
    const current = this.downloads.get(pluginName) || 0;
    this.downloads.set(pluginName, current + 1);
    const plugin = this.plugins.get(pluginName);
    plugin.downloads = current + 1;
    plugin.updated_at = Date.now();
    this.updateTrending();
  }

  updateTrending(window = 7 * 24 * 60 * 60 * 1000) {
    const now = Date.now();
    const trendingScores = new Map();

    for (const [name, plugin] of this.plugins) {
      const age = now - plugin.created_at;
      const timeScore = age < window ? 1 - (age / window) : 0;
      const downloadScore = (this.downloads.get(name) || 0) / 100;
      const ratingData = this.ratings.get(name);
      const ratingScore = ratingData.average / 5;

      const trendScore = (timeScore * 0.3) + (downloadScore * 0.4) + (ratingScore * 0.3);
      trendingScores.set(name, trendScore);
    }

    this.trending.clear();
    const sorted = Array.from(trendingScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [name] of sorted) {
      this.trending.add(name);
    }
  }

  feature(pluginName) {
    if (!this.plugins.has(pluginName)) {
      throw new Error(`Plugin ${pluginName} not found`);
    }
    this.featured.add(pluginName);
  }

  unfeature(pluginName) {
    this.featured.delete(pluginName);
  }

  discover(filters = {}) {
    let results = Array.from(this.plugins.values());

    if (filters.category) {
      MarketplaceValidation.validateCategory(filters.category, this.validCategories);
      const categoryPlugins = Array.from(this.categories.get(filters.category) || []);
      results = results.filter(p => categoryPlugins.includes(p.name));
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();
      results = results.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.keywords && p.keywords.some(k => k.toLowerCase().includes(q)))
      );
    }

    if (filters.tags && Array.isArray(filters.tags)) {
      results = results.filter(p =>
        filters.tags.some(tag => p.tags.includes(tag))
      );
    }

    if (filters.author) {
      results = results.filter(p => p.author.toLowerCase() === filters.author.toLowerCase());
    }

    if (filters.minRating) {
      const min = Math.max(0, Math.min(5, filters.minRating));
      const ratingData = this.ratings.get(p => this.ratings.get(p.name).average >= min);
      results = results.filter(p => this.ratings.get(p.name).average >= min);
    }

    if (filters.maxRating) {
      const max = Math.max(0, Math.min(5, filters.maxRating));
      results = results.filter(p => this.ratings.get(p.name).average <= max);
    }

    if (filters.featured) {
      results = results.filter(p => this.featured.has(p.name));
    }

    if (filters.trending) {
      results = results.filter(p => this.trending.has(p.name));
    }

    if (filters.installed) {
      results = results.filter(p => this.installed.has(p.name));
    }

    const sortMap = {
      'downloads': (a, b) => (this.downloads.get(b.name) || 0) - (this.downloads.get(a.name) || 0),
      'rating': (a, b) => this.ratings.get(b.name).average - this.ratings.get(a.name).average,
      'date': (a, b) => b.updated_at - a.updated_at,
      'name': (a, b) => a.name.localeCompare(b.name),
      'trending': (a, b) => {
        const aScore = this.trending.has(a.name) ? 1 : 0;
        const bScore = this.trending.has(b.name) ? 1 : 0;
        return bScore - aScore;
      }
    };

    if (filters.sort && sortMap[filters.sort]) {
      results.sort(sortMap[filters.sort]);
    } else {
      results.sort(sortMap['downloads']);
    }

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    return results.slice(offset, offset + limit);
  }

  getCategories() {
    return this.validCategories.map(cat => ({
      id: cat,
      name: cat.charAt(0).toUpperCase() + cat.slice(1),
      description: `${cat.charAt(0).toUpperCase() + cat.slice(1)} plugins`,
      plugin_count: this.categories.get(cat).size
    }));
  }

  getFeatured(limit = 20) {
    return Array.from(this.featured)
      .map(name => this.getPluginDetail(name))
      .slice(0, limit);
  }

  getTrending(limit = 20) {
    return Array.from(this.trending)
      .map(name => this.getPluginDetail(name))
      .slice(0, limit);
  }

  getVersions(pluginName) {
    const versions = this.versions.get(pluginName) || [];
    return versions.map(v => ({
      version: v.version,
      released_at: v.created_at,
      deprecated: false,
      breaking_changes: []
    }));
  }

  installPlugin(pluginName) {
    if (!this.plugins.has(pluginName)) {
      throw new Error(`Plugin ${pluginName} not found`);
    }
    this.installed.add(pluginName);
    this.recordDownload(pluginName);
    return this.getPluginDetail(pluginName);
  }

  uninstallPlugin(pluginName) {
    if (!this.installed.has(pluginName)) {
      throw new Error(`Plugin ${pluginName} not installed`);
    }
    this.installed.delete(pluginName);
  }

  getInstalledPlugins() {
    return Array.from(this.installed)
      .map(name => this.getPluginDetail(name));
  }

  getStats() {
    return {
      total_plugins: this.plugins.size,
      total_downloads: Array.from(this.downloads.values()).reduce((a, b) => a + b, 0),
      total_reviews: Array.from(this.reviews.values()).reduce((a, b) => a + b.length, 0),
      installed_plugins: this.installed.size,
      featured_plugins: this.featured.size,
      trending_plugins: this.trending.size,
      categories: this.getCategories(),
      average_rating: this.calculateAverageRating()
    };
  }

  calculateAverageRating() {
    if (this.plugins.size === 0) return 0;
    const sum = Array.from(this.ratings.values()).reduce((acc, r) => acc + r.average, 0);
    return Number((sum / this.plugins.size).toFixed(2));
  }

  export() {
    return {
      seed: this.seed,
      plugins: Array.from(this.plugins.entries()),
      featured: Array.from(this.featured),
      trending: Array.from(this.trending),
      installed: Array.from(this.installed),
      ratings: Array.from(this.ratings.entries()),
      downloads: Array.from(this.downloads.entries()),
      reviews: Array.from(this.reviews.entries()),
      versions: Array.from(this.versions.entries())
    };
  }

  import(data) {
    if (data.seed !== this.seed) {
      throw new Error('Seed mismatch during marketplace import');
    }
    if (data.plugins) {
      for (const [name, plugin] of data.plugins) {
        if (!this.plugins.has(name)) {
          this.plugins.set(name, plugin);
          this.categories.get(plugin.category).add(name);
        }
      }
    }
    if (data.featured) {
      for (const name of data.featured) {
        this.featured.add(name);
      }
    }
    if (data.trending) {
      for (const name of data.trending) {
        this.trending.add(name);
      }
    }
    if (data.installed) {
      for (const name of data.installed) {
        this.installed.add(name);
      }
    }
    if (data.ratings) {
      for (const [name, rating] of data.ratings) {
        this.ratings.set(name, rating);
      }
    }
    if (data.downloads) {
      for (const [name, count] of data.downloads) {
        this.downloads.set(name, count);
      }
    }
    if (data.reviews) {
      for (const [name, reviews] of data.reviews) {
        this.reviews.set(name, reviews);
      }
    }
    if (data.versions) {
      for (const [name, versions] of data.versions) {
        this.versions.set(name, versions);
      }
    }
  }
}

module.exports = PluginMarketplace;
module.exports.MarketplaceValidation = MarketplaceValidation;
