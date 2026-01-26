const PluginMarketplace = require('./marketplace');

class MarketplaceAPI {
  constructor(marketplace) {
    this.marketplace = marketplace;
    this.requestLog = [];
  }

  discover(filters = {}) {
    const startTime = Date.now();
    try {
      const results = this.marketplace.discover(filters);
      this.logRequest('discover', { filters, resultCount: results.length, duration: Date.now() - startTime });
      return {
        success: true,
        data: results,
        count: results.length,
        filters: filters
      };
    } catch (err) {
      this.logRequest('discover', { filters, error: err.message, duration: Date.now() - startTime });
      throw err;
    }
  }

  search(query, options = {}) {
    const filters = { search: query, ...options };
    return this.discover(filters);
  }

  getCategories() {
    try {
      const categories = this.marketplace.getCategories();
      this.logRequest('getCategories', { count: categories.length });
      return {
        success: true,
        data: categories,
        count: categories.length
      };
    } catch (err) {
      this.logRequest('getCategories', { error: err.message });
      throw err;
    }
  }

  getFeatured(limit = 20) {
    try {
      const plugins = this.marketplace.getFeatured(limit);
      this.logRequest('getFeatured', { limit, count: plugins.length });
      return {
        success: true,
        data: plugins,
        count: plugins.length
      };
    } catch (err) {
      this.logRequest('getFeatured', { error: err.message });
      throw err;
    }
  }

  getTrending(limit = 20) {
    try {
      const plugins = this.marketplace.getTrending(limit);
      this.logRequest('getTrending', { limit, count: plugins.length });
      return {
        success: true,
        data: plugins,
        count: plugins.length
      };
    } catch (err) {
      this.logRequest('getTrending', { error: err.message });
      throw err;
    }
  }

  getPluginDetail(name) {
    try {
      const plugin = this.marketplace.getPluginDetail(name);
      this.logRequest('getPluginDetail', { plugin: name });
      return {
        success: true,
        data: plugin
      };
    } catch (err) {
      this.logRequest('getPluginDetail', { plugin: name, error: err.message });
      throw err;
    }
  }

  getVersions(name) {
    try {
      const versions = this.marketplace.getVersions(name);
      this.logRequest('getVersions', { plugin: name, count: versions.length });
      return {
        success: true,
        data: versions,
        count: versions.length
      };
    } catch (err) {
      this.logRequest('getVersions', { plugin: name, error: err.message });
      throw err;
    }
  }

  getReviews(name, limit = 10) {
    try {
      const reviews = this.marketplace.getReviews(name, limit);
      this.logRequest('getReviews', { plugin: name, limit, count: reviews.length });
      return {
        success: true,
        data: reviews,
        count: reviews.length
      };
    } catch (err) {
      this.logRequest('getReviews', { plugin: name, error: err.message });
      throw err;
    }
  }

  submitReview(pluginName, review) {
    try {
      const newReview = this.marketplace.addReview(pluginName, review);
      this.logRequest('submitReview', { plugin: pluginName, reviewId: newReview.id });
      return {
        success: true,
        data: newReview,
        message: 'Review submitted successfully'
      };
    } catch (err) {
      this.logRequest('submitReview', { plugin: pluginName, error: err.message });
      throw err;
    }
  }

  installPlugin(name) {
    try {
      const plugin = this.marketplace.installPlugin(name);
      this.logRequest('installPlugin', { plugin: name });
      return {
        success: true,
        data: plugin,
        message: `${name} installed successfully`
      };
    } catch (err) {
      this.logRequest('installPlugin', { plugin: name, error: err.message });
      throw err;
    }
  }

  uninstallPlugin(name) {
    try {
      this.marketplace.uninstallPlugin(name);
      this.logRequest('uninstallPlugin', { plugin: name });
      return {
        success: true,
        message: `${name} uninstalled successfully`
      };
    } catch (err) {
      this.logRequest('uninstallPlugin', { plugin: name, error: err.message });
      throw err;
    }
  }

  getInstalledPlugins() {
    try {
      const plugins = this.marketplace.getInstalledPlugins();
      this.logRequest('getInstalledPlugins', { count: plugins.length });
      return {
        success: true,
        data: plugins,
        count: plugins.length
      };
    } catch (err) {
      this.logRequest('getInstalledPlugins', { error: err.message });
      throw err;
    }
  }

  getStats() {
    try {
      const stats = this.marketplace.getStats();
      this.logRequest('getStats', {});
      return {
        success: true,
        data: stats
      };
    } catch (err) {
      this.logRequest('getStats', { error: err.message });
      throw err;
    }
  }

  logRequest(endpoint, details) {
    this.requestLog.push({
      endpoint,
      timestamp: Date.now(),
      ...details
    });
    if (this.requestLog.length > 1000) {
      this.requestLog.shift();
    }
  }

  getRequestLog(limit = 100) {
    return this.requestLog.slice(-limit);
  }

  clearRequestLog() {
    this.requestLog = [];
  }
}

module.exports = MarketplaceAPI;
