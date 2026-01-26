const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class StatePersistence {
  constructor() {
    this.stateDir = path.join(process.env.HOME || '/tmp', '.telessh', 'seeds');
    this.ensureDir();
  }

  ensureDir() {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  getPath(seed) {
    const hash = crypto.createHash('sha256').update(seed).digest('hex');
    return path.join(this.stateDir, `${hash}.json`);
  }

  load(seed) {
    const filePath = this.getPath(seed);
    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  save(seed, state) {
    const filePath = this.getPath(seed);
    try {
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
      return true;
    } catch (err) {
      return false;
    }
  }

  delete(seed) {
    const filePath = this.getPath(seed);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch (err) {
        return false;
      }
    }
    return false;
  }

  list() {
    try {
      const files = fs.readdirSync(this.stateDir);
      return files.filter(f => f.endsWith('.json'));
    } catch (err) {
      return [];
    }
  }
}

if (!global.telesshPersist) {
  global.telesshPersist = new StatePersistence();
}

module.exports = global.telesshPersist;
