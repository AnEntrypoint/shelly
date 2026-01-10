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

    canvas.width = this.width;
    canvas.height = this.height;

    // Set up WebSocket
    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('message', (e) => this.onMessage(e));
    this.ws.addEventListener('error', (e) => this.onError(e));

    // Draw initial status
    this.drawStatus('Connecting to display :99...', '#4fc3f7');
    console.log('SimpleVncViewer: initialized');
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
}

window.SimpleVncViewer = SimpleVncViewer;
