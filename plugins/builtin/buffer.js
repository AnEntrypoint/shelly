module.exports = class BufferPlugin {
  constructor(state) {
    this.state = state;
    this.name = 'buffer';
    this.version = '1.0.0';
    this.buffers = new Map();
    this.hooks = {
      'session:created': this.createBuffer.bind(this),
      'session:deleted': this.deleteBuffer.bind(this),
      'data:received': this.appendData.bind(this),
      'buffer:get': this.getBuffer.bind(this),
      'buffer:clear': this.clearBuffer.bind(this)
    };
  }

  async createBuffer(data) {
    const { id } = data;
    this.buffers.set(id, []);
    return data;
  }

  async deleteBuffer(data) {
    const { id } = data;
    this.buffers.delete(id);
    return data;
  }

  async appendData(data) {
    const { sessionId, content } = data;
    if (!this.buffers.has(sessionId)) {
      this.buffers.set(sessionId, []);
    }
    this.buffers.get(sessionId).push(content);
    return data;
  }

  async getBuffer(data) {
    const { sessionId } = data;
    const buffer = this.buffers.get(sessionId) || [];
    return { ...data, content: buffer.join('') };
  }

  async clearBuffer(data) {
    const { sessionId } = data;
    const buffer = this.buffers.get(sessionId) || [];
    const count = buffer.length;
    this.buffers.set(sessionId, []);
    return { ...data, cleared: count };
  }

  getSessionBuffer(sessionId) {
    return this.buffers.get(sessionId) || [];
  }
};
