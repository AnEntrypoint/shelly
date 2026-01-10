// VNC Display - Shows X11 display :99 via x11vnc tunnel
class SimpleVncViewer {
  constructor(ws, canvas) {
    this.ws = ws;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 1024;
    this.height = 768;
    this.frameCount = 0;
    this.bytesReceived = 0;
    this.packer = null;

    canvas.width = this.width;
    canvas.height = this.height;

    // Set up WebSocket
    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('message', (e) => this.onMessage(e));
    this.ws.addEventListener('error', (e) => this.onError(e));

    // Initialize msgpackr packer for sending input
    if (window.msgpackr?.Packr) {
      this.packer = new window.msgpackr.Packr();
    }

    // Draw initial status
    this.drawStatus('Connecting to display :99...', '#4fc3f7');
    console.log('SimpleVncViewer: initialized');
    this.attachInputHandlers();
  }

  drawStatus(msg, color) {
    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.fillStyle = color || '#0f0';
    this.ctx.font = 'bold 24px monospace';
    this.ctx.fillText(msg, 40, 100);

    this.ctx.font = '14px monospace';
    this.ctx.fillStyle = '#858585';
    this.ctx.fillText('Display: X11 :99 (1024x768)', 40, 150);
    this.ctx.fillText('Frames: ' + this.frameCount, 40, 180);
    this.ctx.fillText('Data received: ' + (this.bytesReceived / 1024).toFixed(1) + ' KB', 40, 210);
  }

  onMessage(event) {
    if (!(event.data instanceof ArrayBuffer)) {
      return;
    }

    try {
      // Unpack msgpackr message
      const packed = new Uint8Array(event.data);
      const msg = window.msgpackr.unpack(packed);

      if (!msg || !msg.data) {
        return;
      }

      // Decode base64 data
      const binary = atob(msg.data);
      const data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        data[i] = binary.charCodeAt(i);
      }

      this.frameCount++;
      this.bytesReceived += data.length;

      console.log('SimpleVncViewer: frame ' + this.frameCount + ' (' + data.length + ' bytes)');

      // If data looks like RGB pixels (multiple of 3), render as image
      if (data.length % 3 === 0 && data.length >= 786432) {
        try {
          this.renderImage(data);
        } catch (e) {
          this.drawStatus('Rendering frame...', '#f48771');
        }
      } else {
        // Show status
        this.drawStatus('Receiving frame ' + this.frameCount + '...', '#4fc3f7');
      }
    } catch (err) {
      console.log('SimpleVncViewer: Unpack error:', err.message);
    }
  }

  renderImage(data) {
    const imageData = this.ctx.createImageData(this.width, this.height);
    const pixels = imageData.data;

    // Copy RGB → RGBA
    let src = 0;
    for (let i = 0; i < pixels.length && src < data.length; i += 4) {
      pixels[i] = data[src++];     // R
      pixels[i + 1] = data[src++]; // G
      pixels[i + 2] = data[src++]; // B
      pixels[i + 3] = 255;         // A
    }

    this.ctx.putImageData(imageData, 0, 0);

    // Overlay with frame count
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.fillRect(10, 10, 250, 70);
    this.ctx.fillStyle = '#0f0';
    this.ctx.font = '13px monospace';
    this.ctx.fillText('✓ Display streaming', 20, 35);
    this.ctx.fillText('Frames: ' + this.frameCount, 20, 55);
    this.ctx.fillText('KB: ' + (this.bytesReceived / 1024).toFixed(0), 20, 75);
  }

  onError(err) {
    console.log('SimpleVncViewer error:', err);
    this.drawStatus('Connection error', '#f48771');
  }

  sendPointerEvent(x, y, buttons) {
    if (!this.ws || this.ws.readyState !== 1 || !this.packer) return;
    const rfb = new Uint8Array(6);
    rfb[0] = 6; // PointerEvent type
    rfb[1] = buttons & 0xFF; // Button mask
    rfb[2] = (x >> 8) & 0xFF;
    rfb[3] = x & 0xFF;
    rfb[4] = (y >> 8) & 0xFF;
    rfb[5] = y & 0xFF;
    this.sendVncFrame(rfb);
  }

  sendKeyEvent(key, down) {
    if (!this.ws || this.ws.readyState !== 1 || !this.packer) return;
    const rfb = new Uint8Array(8);
    rfb[0] = 4; // KeyEvent type
    rfb[1] = down ? 1 : 0;
    rfb[2] = 0;
    rfb[3] = 0;
    const keyCode = this.mapKeyCode(key);
    rfb[4] = (keyCode >> 24) & 0xFF;
    rfb[5] = (keyCode >> 16) & 0xFF;
    rfb[6] = (keyCode >> 8) & 0xFF;
    rfb[7] = keyCode & 0xFF;
    this.sendVncFrame(rfb);
  }

  sendVncFrame(data) {
    if (!this.packer || !this.ws) return;
    try {
      const b64 = this.bytesToBase64(data);
      const msg = this.packer.pack({ type: 'vnc_frame', data: b64 });
      this.ws.send(msg);
    } catch (err) {
      console.log('SimpleVncViewer: sendVncFrame error:', err.message);
    }
  }

  bytesToBase64(bytes) {
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return btoa(str);
  }

  mapKeyCode(key) {
    const keyMap = {
      'Enter': 0xFF0D, 'Escape': 0xFF1B, 'Backspace': 0xFF08, 'Tab': 0xFF09,
      'Shift': 0xFFE1, 'Control': 0xFFE3, 'Alt': 0xFFE9,
      'ArrowUp': 0xFF52, 'ArrowDown': 0xFF54, 'ArrowLeft': 0xFF51, 'ArrowRight': 0xFF53,
      'Home': 0xFF50, 'End': 0xFF57, 'PageUp': 0xFF55, 'PageDown': 0xFF56,
      'Delete': 0xFFFF, ' ': 0x0020
    };
    return keyMap[key] || key.charCodeAt(0);
  }

  attachInputHandlers() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('wheel', (e) => this.onScroll(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  onMouseDown(e) {
    const { x, y } = this.getCanvasCoords(e);
    const buttons = this.getButtonMask(e.button, true);
    this.sendPointerEvent(x, y, buttons);
    e.preventDefault();
  }

  onMouseUp(e) {
    const { x, y } = this.getCanvasCoords(e);
    const buttons = this.getButtonMask(e.button, false);
    this.sendPointerEvent(x, y, buttons);
    e.preventDefault();
  }

  onMouseMove(e) {
    const { x, y } = this.getCanvasCoords(e);
    this.sendPointerEvent(x, y, e.buttons);
  }

  onScroll(e) {
    const { x, y } = this.getCanvasCoords(e);
    const direction = e.deltaY > 0 ? 8 : 16; // Scroll down: btn 8, up: btn 4
    this.sendPointerEvent(x, y, direction);
    e.preventDefault();
  }

  onKeyDown(e) {
    if (!this.isVncFocused()) return;
    this.sendKeyEvent(e.key, true);
    e.preventDefault();
  }

  onKeyUp(e) {
    if (!this.isVncFocused()) return;
    this.sendKeyEvent(e.key, false);
    e.preventDefault();
  }

  getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (this.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (this.height / rect.height));
    return { x: Math.max(0, Math.min(x, this.width - 1)), y: Math.max(0, Math.min(y, this.height - 1)) };
  }

  getButtonMask(button, pressed) {
    const masks = { 0: 1, 1: 2, 2: 4 }; // Left, Middle, Right
    return pressed ? (masks[button] || 0) : 0;
  }

  isVncFocused() {
    return document.activeElement === this.canvas || document.getElementById('vnc-modal')?.classList.contains('active');
  }
}

window.SimpleVncViewer = SimpleVncViewer;
