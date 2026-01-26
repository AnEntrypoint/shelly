module.exports = class ValidationPlugin {
  constructor(state) {
    this.state = state;
    this.name = 'validation';
    this.version = '1.0.0';
    this.rules = new Map();
    this.hooks = {
      'validate:input': this.validateInput.bind(this),
      'validate:session': this.validateSession.bind(this),
      'validate:data': this.validateData.bind(this)
    };
    this.initDefaultRules();
  }

  initDefaultRules() {
    this.rules.set('seed', {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 255,
      pattern: /^[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=]+$/
    });
    this.rules.set('user', {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 32,
      pattern: /^[a-zA-Z0-9_-]+$/
    });
    this.rules.set('sessionId', {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 64
    });
    this.rules.set('data', {
      type: 'string',
      required: true,
      maxLength: 1048576
    });
  }

  async validateInput(data) {
    const { field, value } = data;
    const rule = this.rules.get(field);
    if (!rule) return data;

    if (rule.required && !value) {
      throw new Error(`${field} is required`);
    }
    if (typeof value !== rule.type) {
      throw new Error(`${field} must be ${rule.type}, got ${typeof value}`);
    }
    if (rule.minLength && value.length < rule.minLength) {
      throw new Error(`${field} minimum length is ${rule.minLength}`);
    }
    if (rule.maxLength && value.length > rule.maxLength) {
      throw new Error(`${field} maximum length is ${rule.maxLength}`);
    }
    if (rule.pattern && !rule.pattern.test(value)) {
      throw new Error(`${field} contains invalid characters`);
    }

    return data;
  }

  async validateSession(data) {
    const { sessionId } = data;
    const session = this.state.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.state === 'disconnected') {
      throw new Error(`Session ${sessionId} is disconnected`);
    }
    return data;
  }

  async validateData(data) {
    const { content } = data;
    if (typeof content !== 'string') {
      throw new Error('Data content must be string');
    }
    if (content.length > 1048576) {
      throw new Error('Data exceeds maximum size');
    }
    return data;
  }

  addRule(field, rule) {
    this.rules.set(field, rule);
  }

  getRule(field) {
    return this.rules.get(field);
  }
};
