// Minimal RFB-compatible VNC client with proper protocol handling
class MinimalVncViewer {
  constructor(ws, canvas) {
    this.ws = ws;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 1024;
    this.height = 768;
    this.depth = 24;
    this.bigEndian = false;
    this.trueColor = true;

    this.buffer = new Uint8Array(0);
    this.state = 'handshake';
    this.frameCount = 0;

    canvas.width = this.width;
    canvas.height = this.height;

    // Draw initial screen
    this.drawInitial();

    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('message', (e) => this.onMessage(e));
    this.ws.addEventListener('open', () => this.sendHandshake());
  }

  drawInitial() {
    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = '#0f0';
    this.ctx.font = 'bold 16px monospace';
    this.ctx.fillText('VNC Display :99', 20, 40);
    this.ctx.font = '12px monospace';
    this.ctx.fillText('Connecting...', 20, 65);
  }

  sendHandshake() {
    try {
      console.log('VNC: Sending handshake "RFB 003.008\\n"');
      this.ws.send('RFB 003.008\n');
    } catch (e) {
      console.log('VNC: Handshake error:', e.message);
    }
  }

  onMessage(event) {
    if (!(event.data instanceof ArrayBuffer)) {
      console.log('VNC: Skipping non-ArrayBuffer message:', typeof event.data);
      return;
    }

    const newData = new Uint8Array(event.data);
    console.log(`VNC: Received ${newData.length} bytes in state="${this.state}"`);

    const combined = new Uint8Array(this.buffer.length + newData.length);
    combined.set(this.buffer);
    combined.set(newData, this.buffer.length);
    this.buffer = combined;

    this.processBuffer();
  }

  processBuffer() {
    if (this.state === 'handshake') {
      this.handleHandshake();
    } else if (this.state === 'security') {
      this.handleSecurity();
    } else if (this.state === 'auth') {
      this.handleAuth();
    } else if (this.state === 'serverinit') {
      this.handleServerInit();
    } else if (this.state === 'ready') {
      this.handleFramebufferUpdate();
    }
  }

  handleHandshake() {
    // Server sends: "RFB 003.008\n"
    // Client must respond with: "RFB 003.008\n"
    const str = new TextDecoder().decode(this.buffer);
    const lines = str.split('\n');

    console.log('VNC: handleHandshake - buffer length:', this.buffer.length, 'str:', str.substring(0, 50));

    if (lines.length < 1 || !lines[0].includes('RFB')) {
      console.log('VNC: Waiting for RFB handshake from server');
      return;
    }
    if (!str.includes('\n')) {
      console.log('VNC: Incomplete handshake, waiting for newline');
      return;
    }

    // Consume handshake
    const consumed = str.indexOf('\n') + 1;
    this.buffer = this.buffer.slice(consumed);
    console.log('VNC: Received server handshake:', lines[0]);
    console.log('VNC: Sending client handshake: RFB 003.008');

    // Send our own version string (matching server's version)
    this.ws.send('RFB 003.008\n');
    this.state = 'security';
  }

  handleSecurity() {
    if (this.buffer.length < 1) {
      console.log('VNC: Waiting for security types list');
      return;
    }
    const numSecTypes = this.buffer[0];
    console.log('VNC: Server offers', numSecTypes, 'security type(s)');

    if (numSecTypes === 0) {
      console.log('VNC: No security types available!');
      this.buffer = this.buffer.slice(1);
      this.state = 'serverinit';
      return;
    }

    // Need at least numSecTypes + 1 bytes
    if (this.buffer.length < 1 + numSecTypes) {
      console.log('VNC: Waiting for all security types (have', this.buffer.length, 'need', 1 + numSecTypes + ')');
      return;
    }

    // Read security types and select the first one
    const secTypes = [];
    for (let i = 0; i < numSecTypes; i++) {
      secTypes.push(this.buffer[1 + i]);
    }
    console.log('VNC: Available security types:', secTypes);

    // Select type 1 (None) if available, otherwise type 0
    const selectedType = secTypes.includes(1) ? 1 : secTypes[0];
    console.log('VNC: Selecting security type:', selectedType);

    this.buffer = this.buffer.slice(1 + numSecTypes);
    this.ws.send(new Uint8Array([selectedType]));
    this.state = 'serverinit';
  }

  handleAuth() {
    // No authentication needed for default x11vnc
    this.state = 'serverinit';
  }

  handleServerInit() {
    console.log('VNC: handleServerInit - buffer length:', this.buffer.length);
    if (this.buffer.length < 24) {
      console.log('VNC: Waiting for ServerInit message (need 24 bytes, have', this.buffer.length + ')');
      return;
    }

    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset);
    this.width = view.getUint16(0, false);
    this.height = view.getUint16(2, false);
    console.log(`VNC: ServerInit - width=${this.width}, height=${this.height}`);

    const pixelFormat = {
      bitsPerPixel: this.buffer[4],
      depth: this.buffer[5],
      bigEndian: this.buffer[6] !== 0,
      trueColor: this.buffer[7] !== 0,
      redMax: view.getUint16(8, !this.buffer[6]),
      greenMax: view.getUint16(10, !this.buffer[6]),
      blueMax: view.getUint16(12, !this.buffer[6]),
      redShift: this.buffer[14],
      greenShift: this.buffer[15],
      blueShift: this.buffer[16]
    };

    this.depth = pixelFormat.depth;
    this.trueColor = pixelFormat.trueColor;
    this.bigEndian = pixelFormat.bigEndian;

    // Skip server name length and name
    if (this.buffer.length < 24) return;
    const nameLen = view.getUint32(20, false);
    if (this.buffer.length < 24 + nameLen) return;

    this.buffer = this.buffer.slice(24 + nameLen);

    // Resize canvas and request framebuffer update
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.imageData = this.ctx.createImageData(this.width, this.height);

    // Send framebuffer update request
    this.requestUpdate();
    this.state = 'ready';
  }

  requestUpdate() {
    const msg = new Uint8Array(10);
    msg[0] = 3; // FramebufferUpdateRequest
    msg[1] = 1; // incremental
    // x, y, width, height (all zeros for full screen)
    this.ws.send(msg);
  }

  handleFramebufferUpdate() {
    if (this.buffer.length < 6) return;

    if (this.buffer[0] !== 0) {
      // Not a FramebufferUpdate message
      return;
    }

    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset);
    const numRects = view.getUint16(2, false);

    let offset = 4;
    let rectsProcessed = 0;

    while (rectsProcessed < numRects && offset < this.buffer.length) {
      if (offset + 12 > this.buffer.length) break;

      const x = view.getUint16(offset, false);
      const y = view.getUint16(offset + 2, false);
      const w = view.getUint16(offset + 4, false);
      const h = view.getUint16(offset + 6, false);
      const encoding = view.getInt32(offset + 8, false);

      offset += 12;

      if (encoding === 0) {
        // Raw encoding
        const bytesPerPixel = this.depth === 24 ? 3 : 4;
        const dataSize = w * h * bytesPerPixel;

        if (offset + dataSize > this.buffer.length) break;

        this.renderRawRect(x, y, w, h, offset);
        offset += dataSize;
      } else if (encoding === -1) {
        // Cursor pseudo-encoding
        const dataSize = ((w + 7) / 8) * h + w * h * 4;
        offset += dataSize;
      }

      rectsProcessed++;
    }

    if (rectsProcessed > 0) {
      this.buffer = this.buffer.slice(offset);
      this.frameCount++;

      // Update display
      try {
        this.ctx.putImageData(this.imageData, 0, 0);
      } catch (e) {}

      // Request next update
      setTimeout(() => this.requestUpdate(), 50);
    }
  }

  renderRawRect(x, y, w, h, dataOffset) {
    const bytesPerPixel = this.depth === 24 ? 3 : 4;
    const pixels = this.imageData.data;
    const data = this.buffer;

    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const dataIdx = dataOffset + (row * w + col) * bytesPerPixel;
        const pixIdx = ((y + row) * this.width + (x + col)) * 4;

        if (this.depth === 24) {
          // RGB 24-bit
          pixels[pixIdx] = data[dataIdx + 2]; // R
          pixels[pixIdx + 1] = data[dataIdx + 1]; // G
          pixels[pixIdx + 2] = data[dataIdx]; // B
          pixels[pixIdx + 3] = 255; // A
        } else {
          // RGBA 32-bit
          pixels[pixIdx] = data[dataIdx + 2];
          pixels[pixIdx + 1] = data[dataIdx + 1];
          pixels[pixIdx + 2] = data[dataIdx];
          pixels[pixIdx + 3] = 255;
        }
      }
    }
  }
}

window.MinimalVncViewer = MinimalVncViewer;
