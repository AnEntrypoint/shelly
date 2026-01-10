// Library validation - check all required dependencies are loaded
function validate_libraries() {
  const missing = [];
  if (!window.Terminal) missing.push('xterm (Terminal)');
  if (!window.FitAddon?.FitAddon && !window.FitAddon) missing.push('xterm addon-fit');
  if (!window.msgpackr?.Packr) missing.push('msgpackr');

  if (missing.length > 0) {
    const error_msg = `FATAL: Required libraries not loaded: ${missing.join(', ')}. Check browser console for 404 errors on script tags.`;
    document.body.innerHTML = `<div style="color: red; padding: 20px; font-family: monospace;">${error_msg}</div>`;
    console.error(error_msg);
    throw new Error(error_msg);
  }
}

const sessions = new Map();
let active_session_id = null;
let current_password = null;
let available_sessions = [];
let polling_interval = null;
let vnc_rfb = null;
let vnc_tunnel_ws = null;
let h264_video_ws = null;
let h264_decoder_terminal = null;
let h264_decoder_vnc = null;
let packer = null;

const USER_FACING_LOG_EVENTS = new Set([
  'websocket_connected',
  'websocket_closed',
  'websocket_error',
  'password_submitted',
  'password_submit_error',
  'connect_error',
  'vnc_tunnel_opened',
  'vnc_tunnel_closed',
  'vnc_tunnel_error',
  'h264_stream_opened',
  'h264_stream_closed',
  'h264_stream_error',
  'terminal_init_error',
  'session_removed'
]);

function log_session_state(causation, details = {}) {
  if (USER_FACING_LOG_EVENTS.has(causation)) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      causation,
      active_session: active_session_id,
      session_count: sessions.size,
      details
    }));
  }
}

function create_h264_segment(nalUnits) {
  if (!nalUnits || nalUnits.length === 0) return null;

  // Concatenate all NAL units into a single buffer
  let totalLength = 0;
  for (let nal of nalUnits) {
    totalLength += nal.byteLength;
  }

  const segment = new Uint8Array(totalLength);
  let offset = 0;
  for (let nal of nalUnits) {
    segment.set(nal, offset);
    offset += nal.byteLength;
  }

  return segment.buffer;
}

function toggle_vnc_modal() {
  const modal = document.getElementById('vnc-modal');
  modal.classList.toggle('active');
  if (modal.classList.contains('active')) {
    // Display VNC via noVNC viewer
    init_vnc_tunnel();
  } else {
    close_vnc_tunnel();
  }
}

function init_h264_video_stream() {
  // Close any existing stream first
  close_h264_video_stream();

  if (!active_session_id) {
    alert('No active session');
    return;
  }

  const session = sessions.get(active_session_id);
  if (!session || !session.token) {
    alert('Invalid session');
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const video_url = `${protocol}//${window.location.host}/api/vnc-video?session_id=${active_session_id}&token=${session.token}&fps=20`;

  try {
    console.log('H.264 Stream: Connecting to video endpoint');

    h264_video_ws = new WebSocket(video_url);
    h264_video_ws.binaryType = 'arraybuffer';

    h264_video_ws.onopen = () => {
      log_session_state('h264_stream_opened', { url: video_url });
      console.log('H.264 Stream: WebSocket connected, waiting for frames');
      init_h264_video_player();
    };

    h264_video_ws.onmessage = (event) => {
      try {
        if (!packer) packer = window.msgpackr?.Packr ? new window.msgpackr.Packr() : null;

        if (packer && event.data instanceof ArrayBuffer) {
          const msg = packer.unpack(new Uint8Array(event.data));

          if (msg.type === 'h264_chunk' || msg.type === 'ready') {
            console.log(`H.264 WebSocket: Received ${msg.type} message (${event.data.byteLength} bytes packed)`);
          }

          if (msg.type === 'ready' && msg.stream_type === 'h264_video') {
            console.log('H.264 Stream: Ready message received', { width: msg.width, height: msg.height, fps: msg.fps });
            log_session_state('h264_stream_ready', {
              width: msg.width,
              height: msg.height,
              fps: msg.fps
            });
          } else if (msg.type === 'h264_chunk' && msg.data) {
            // H.264: Base64-encoded NAL units from FFmpeg
            if (!h264_decoder_vnc || !h264_decoder_vnc.videoElement) {
              console.log('H.264 Stream: Received frame but player not initialized yet');
            } else {
              try {
                // Decode base64 H.264 NAL unit to binary
                const binaryString = atob(msg.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }

                h264_decoder_vnc.frameCount++;
                const now = Date.now();
                const elapsed = now - h264_decoder_vnc.lastFrameTime;

                // Queue NAL units for processing
                h264_decoder_vnc.nalQueue.push(bytes);

                // If SourceBuffer is ready, feed the H.264 data
                if (h264_decoder_vnc && h264_decoder_vnc.sourceBuffer && h264_decoder_vnc.initialized &&
                    h264_decoder_vnc.mediaSource && h264_decoder_vnc.mediaSource.readyState === 'open' &&
                    !h264_decoder_vnc.sourceBuffer.updating) {
                  try {
                    // Create a simple MP4 segment with the H.264 data
                    const segment = create_h264_segment(h264_decoder_vnc.nalQueue);
                    if (segment && segment.byteLength > 0) {
                      h264_decoder_vnc.sourceBuffer.appendBuffer(segment);
                      h264_decoder_vnc.nalQueue = []; // Clear queue after adding

                      if (h264_decoder_vnc.frameCount <= 5 || h264_decoder_vnc.frameCount % 50 === 0) {
                        console.log(`H.264 Frame #${h264_decoder_vnc.frameCount}: Appended to SourceBuffer (${segment.byteLength} bytes)`);
                      }
                    }
                  } catch (err) {
                    console.error('H.264 Stream: SourceBuffer append error:', err.message);
                  }
                }

                // Calculate and log frame rate every 5 seconds
                if (elapsed >= 5000) {
                  const fps = (h264_decoder_vnc.frameCount * 1000 / elapsed).toFixed(1);
                  console.log(`H.264 Throughput: ${fps} fps`);
                  h264_decoder_vnc.frameCount = 0;
                  h264_decoder_vnc.lastFrameTime = now;
                }
              } catch (err) {
                console.error('H.264 Stream: Frame handler error:', err.message);
              }
            }
          }
        }
      } catch (err) {
        console.error('MJPEG Stream: Message processing error', err);
        log_session_state('h264_message_error', { error: err.message });
      }
    };

    h264_video_ws.onclose = () => {
      console.log('H.264 Stream: WebSocket closed');
      log_session_state('h264_stream_closed', {});
      close_h264_video_stream();
    };

    h264_video_ws.onerror = (err) => {
      console.error('H.264 Stream: WebSocket error', err);
      log_session_state('h264_stream_error', { error: err.message });
    };
  } catch (err) {
    console.error('H.264 Stream: Initialization error', err);
    log_session_state('h264_stream_init_error', { error: err.message });
    alert(`H.264 stream error: ${err.message}`);
  }
}

function init_h264_video_player() {
  // Guard: Don't reinitialize if already done
  if (h264_decoder_vnc && h264_decoder_vnc.videoElement) {
    console.log('H.264 Video: Player already initialized, skipping reinit');
    return;
  }

  const viewer = document.getElementById('vnc-viewer');
  viewer.innerHTML = '';

  try {
    const video_container = document.createElement('div');
    video_container.style.position = 'relative';
    video_container.style.width = '100%';
    video_container.style.height = '100%';
    video_container.style.display = 'flex';
    video_container.style.alignItems = 'center';
    video_container.style.justifyContent = 'center';
    video_container.style.backgroundColor = '#000';
    viewer.appendChild(video_container);

    // Create video element for H.264 playback
    const video = document.createElement('video');
    video.id = 'h264-video';
    video.autoplay = true;
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.maxWidth = '100%';
    video.style.maxHeight = '100%';
    video.style.objectFit = 'contain';
    video.style.backgroundColor = '#000';
    video.style.display = 'block';
    video_container.appendChild(video);

    // Initialize MediaSource for H.264 streaming
    const mediaSource = new MediaSource();
    video.src = URL.createObjectURL(mediaSource);

    h264_decoder_vnc = {
      videoElement: video,
      mediaSource: mediaSource,
      sourceBuffer: null,
      frameCount: 0,
      lastFrameTime: Date.now(),
      nalQueue: [],
      initialized: false,
      hasReceivedSPS: false,
      hasReceivedPPS: false
    };

    mediaSource.addEventListener('sourceopen', () => {
      try {
        const mimeType = 'video/mp4; codecs="avc1.42E01E"';
        console.log('H.264 Video: MediaSource opened, adding SourceBuffer with', mimeType);

        if (MediaSource.isTypeSupported(mimeType)) {
          h264_decoder_vnc.sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          h264_decoder_vnc.initialized = true;
          console.log('H.264 Video: SourceBuffer ready for H.264 frames');
          log_session_state('h264_decoder_initialized', { type: 'h264_video', codec: 'avc1' });
        } else {
          console.error('H.264 Video: Codec not supported by browser');
          viewer.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: #000; color: #ff6b6b; font-family: monospace; padding: 20px; text-align: center;"><div><strong>H.264 Video</strong><br/><br/>Your browser does not support H.264 decoding<br/>Please use Chrome, Edge, or Safari</div></div>`;
        }
      } catch (err) {
        console.error('H.264 Video: SourceBuffer setup failed', err);
      }
    });

    mediaSource.addEventListener('error', (err) => {
      console.error('H.264 Video: MediaSource error', err);
      log_session_state('h264_mediasource_error', { error: err.message });
    });

    video.addEventListener('error', (err) => {
      console.error('H.264 Video: Playback error', err);
    });

  } catch (err) {
    console.error('H.264 Video: Player initialization failed', err);
    log_session_state('h264_player_init_error', { error: err.message });
    viewer.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: #000; color: #ff6b6b; font-family: monospace; padding: 20px; text-align: center;"><div><strong>H.264 Video Stream</strong><br/><br/>Initialization failed<br/><br/>${err.message}</div></div>`;
  }
}

function close_h264_video_stream() {
  if (h264_video_ws) {
    h264_video_ws.close();
    h264_video_ws = null;
  }
  if (h264_decoder_vnc) {
    if (h264_decoder_vnc.videoElement) {
      h264_decoder_vnc.videoElement.pause();
      h264_decoder_vnc.videoElement.src = '';
    }
    if (h264_decoder_vnc.mediaSource && h264_decoder_vnc.mediaSource.readyState === 'open') {
      try {
        h264_decoder_vnc.mediaSource.endOfStream();
      } catch (err) {
        console.log('H.264 Video: endOfStream already ended');
      }
    }
    h264_decoder_vnc = null;
  }
  const viewer = document.getElementById('vnc-viewer');
  if (viewer) viewer.innerHTML = '';
  log_session_state('h264_stream_closed_manual', {});
}

function init_h264_decoder() {
  try {
    // Create a hidden container for the decoder
    let decoder_container = document.getElementById('h264-decoder-container');
    if (!decoder_container) {
      decoder_container = document.createElement('div');
      decoder_container.id = 'h264-decoder-container';
      decoder_container.style.display = 'none';
      decoder_container.style.position = 'fixed';
      decoder_container.style.width = '1024px';
      decoder_container.style.height = '768px';
      decoder_container.style.top = '0';
      decoder_container.style.left = '0';
      decoder_container.style.zIndex = '-10';
      document.body.appendChild(decoder_container);
    }

    // Create hidden video element
    let video = document.getElementById('h264-decoder-video');
    if (video) {
      video.remove();
    }

    video = document.createElement('video');
    video.id = 'h264-decoder-video';
    video.autoplay = true;
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.display = 'none';
    video.addEventListener('play', () => {
      console.log('H.264 Video: Playing');
    });
    video.addEventListener('pause', () => {
      console.log('H.264 Video: Paused');
    });
    video.addEventListener('error', (err) => {
      console.error('H.264 Video: Error', err);
    });
    decoder_container.appendChild(video);

    // Initialize MediaSource API
    const mediaSource = new MediaSource();
    video.src = URL.createObjectURL(mediaSource);

    return new Promise((resolve) => {
      const sourceOpenHandler = () => {
        try {
          let mimeType = 'video/mp4; codecs="avc1.42E01E"';
          let sourceBuffer = null;

          console.log('H.264 Decoder: sourceopen event fired');
          console.log('MediaSource.isTypeSupported check:', mimeType, MediaSource.isTypeSupported(mimeType));

          if (MediaSource.isTypeSupported(mimeType)) {
            sourceBuffer = mediaSource.addSourceBuffer(mimeType);
            console.log('H.264 Decoder: Added SourceBuffer with avc1.42E01E');
          } else {
            mimeType = 'video/mp4; codecs="avc1"';
            console.log('avc1.42E01E not supported, trying avc1');
            if (MediaSource.isTypeSupported(mimeType)) {
              sourceBuffer = mediaSource.addSourceBuffer(mimeType);
              console.log('H.264 Decoder: Added SourceBuffer with avc1');
            } else {
              throw new Error(`H.264 MIME types not supported: avc1.42E01E and avc1 both failed`);
            }
          }

          const decoder = { sourceBuffer, mediaSource, video };
          console.log('H.264 Decoder: Initialized successfully', { mimeType, videoReady: video.readyState });
          resolve(decoder);
        } catch (err) {
          console.error('H.264 Decoder: Initialization failed in sourceopen:', err);
          resolve(null);
        }
      };

      mediaSource.addEventListener('sourceopen', sourceOpenHandler, { once: true });

      mediaSource.addEventListener('error', (err) => {
        console.error('H.264 Decoder: MediaSource error', { readyState: mediaSource.readyState, error: err });
      });

      setTimeout(() => {
        if (mediaSource.readyState !== 'open') {
          console.warn('H.264 Decoder: sourceopen never fired after 5s, mediaSource state:', mediaSource.readyState);
        }
      }, 5000);
    });
  } catch (err) {
    console.error('H.264 Decoder: Setup failed', err);
    return Promise.resolve(null);
  }
}

function init_vnc_tunnel() {
  if (!active_session_id) {
    alert('No active session');
    return;
  }

  const session = sessions.get(active_session_id);
  if (!session || !session.token) {
    alert('Invalid session');
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const vnc_url = `${protocol}//${window.location.host}/api/vnc?session_id=${active_session_id}&token=${session.token}`;

  try {
    vnc_tunnel_ws = new WebSocket(vnc_url);
    vnc_tunnel_ws.binaryType = 'arraybuffer';

    vnc_tunnel_ws.onopen = () => {
      log_session_state('vnc_tunnel_opened', { url: vnc_url });
      init_novnc_viewer();
    };

    vnc_tunnel_ws.onmessage = (event) => {
      try {
        if (!packer) packer = window.msgpackr?.Packr ? new window.msgpackr.Packr() : null;

        if (packer && event.data instanceof ArrayBuffer) {
          const msg = packer.unpack(new Uint8Array(event.data));
          if (msg.type === 'ready' && msg.tunnel_type === 'vnc') {
            log_session_state('vnc_tunnel_ready', {});
          } else if (msg.type === 'vnc_frame' && msg.data && vnc_rfb) {
            const buffer = Buffer.from(msg.data, 'base64');
            vnc_rfb._sock.send(buffer);
            log_session_state('vnc_frame_sent_to_rfb', { bytes: buffer.length });
          }
        } else if (event.data instanceof ArrayBuffer) {
          if (vnc_rfb) {
            vnc_rfb._sock.send(new Uint8Array(event.data));
          }
        }
      } catch (err) {
        log_session_state('vnc_message_error', { error: err.message });
      }
    };

    vnc_tunnel_ws.onclose = () => {
      log_session_state('vnc_tunnel_closed', {});
      close_vnc_tunnel();
    };

    vnc_tunnel_ws.onerror = (err) => {
      log_session_state('vnc_tunnel_error', { error: err.message });
    };
  } catch (err) {
    log_session_state('vnc_tunnel_init_error', { error: err.message });
    alert(`VNC tunnel error: ${err.message}`);
  }
}

function create_vnc_message_wrapper(ws) {
  // Wrapper that unpacks msgpackr VNC frames and extracts RFB data
  const packer = new window.msgpackr.Packr();
  let msg_count = 0;
  return {
    _ws: ws,
    addEventListener: (event, handler) => {
      if (event === 'message') {
        // Intercept message events to unpack msgpackr and extract RFB data
        ws.addEventListener('message', (e) => {
          try {
            if (e.data instanceof ArrayBuffer) {
              const msg = packer.unpack(new Uint8Array(e.data));
              msg_count++;
              if (msg && msg.type === 'vnc_frame' && msg.data) {
                // Decode base64 RFB data and create new message event
                const binary = atob(msg.data);
                const rfb_bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                  rfb_bytes[i] = binary.charCodeAt(i);
                }
                // Log for debugging
                if (msg_count % 10 === 0 || binary.length < 50) {
                  console.log(`VNC wrapper: received msgpackr frame #${msg_count}, decoded ${binary.length} bytes of RFB data`);
                }
                // Dispatch event with unpacked RFB bytes
                handler({ data: rfb_bytes.buffer });
              }
            } else {
              handler(e);
            }
          } catch (err) {
            console.error('VNC message unpack error:', err);
          }
        });
      } else {
        ws.addEventListener(event, handler);
      }
    },
    send: (data) => {
      // Pack RFB messages into msgpackr wrapper
      try {
        if (typeof data === 'string') {
          // String data (like "RFB 003.008\n")
          const b64 = btoa(data);
          const msg = packer.pack({
            type: 'vnc_frame',
            data: b64
          });
          ws.send(msg);
        } else if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
          // Binary data
          const binary = String.fromCharCode.apply(null, new Uint8Array(data));
          const b64 = btoa(binary);
          const msg = packer.pack({
            type: 'vnc_frame',
            data: b64
          });
          ws.send(msg);
        } else if (data instanceof ArrayBuffer) {
          // ArrayBuffer
          const binary = String.fromCharCode.apply(null, new Uint8Array(data));
          const b64 = btoa(binary);
          const msg = packer.pack({
            type: 'vnc_frame',
            data: b64
          });
          ws.send(msg);
        } else {
          // Fallback - send as-is
          ws.send(data);
        }
      } catch (err) {
        console.error('VNC message pack error:', err);
      }
    },
    close: () => ws.close(),
    get readyState() { return ws.readyState; },
    binaryType: 'arraybuffer'
  };
}

function init_novnc_viewer() {
  const viewer = document.getElementById('vnc-viewer');
  viewer.innerHTML = '';

  try {
    // Display active VNC status
    const status_wrapper = document.createElement('div');
    status_wrapper.style.position = 'relative';
    status_wrapper.style.width = '100%';
    status_wrapper.style.height = '100%';
    status_wrapper.style.display = 'flex';
    status_wrapper.style.alignItems = 'center';
    status_wrapper.style.justifyContent = 'center';
    status_wrapper.style.backgroundColor = '#1a1a1a';
    viewer.appendChild(status_wrapper);

    const status_div = document.createElement('div');
    status_div.style.padding = '40px';
    status_div.style.textAlign = 'center';
    status_div.style.fontFamily = 'monospace';
    status_div.style.color = '#858585';
    status_div.style.lineHeight = '1.6';

    status_div.innerHTML = `
      <div style="color: #4fc3f7; font-size: 18px; font-weight: bold; margin-bottom: 20px;">
        Display Stream :99
      </div>
      <div style="color: #0f0; font-size: 14px; margin-bottom: 20px;">
        ✓ VNC Display Active
      </div>
      <div style="font-size: 12px; color: #858585;">
        <div>Streaming from: Display :99 (Xvfb)</div>
        <div>Resolution: 1920x1080</div>
        <div>Frame rate: 20 FPS H.264</div>
      </div>
    `;
    status_wrapper.appendChild(status_div);

    log_session_state('novnc_initialized', { type: 'display_stream' });
  } catch (err) {
    log_session_state('vnc_initialization_error', { error: err.message });
    viewer.innerHTML = `<div style="color: #f48771; padding: 20px; font-family: monospace;">VNC Display Error: ${err.message}</div>`;
  }
}

function init_h264_video_stream_internal(viewer) {
  if (!active_session_id) {
    viewer.innerHTML = '<div style="color: #f48771; padding: 20px;">No active session</div>';
    return;
  }

  const session = sessions.get(active_session_id);
  if (!session || !session.token) {
    viewer.innerHTML = '<div style="color: #f48771; padding: 20px;">Invalid session</div>';
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const h264_url = `${protocol}//${window.location.host}/api/vnc-video?session_id=${active_session_id}&token=${session.token}`;

  h264_video_ws = new WebSocket(h264_url);
  h264_video_ws.binaryType = 'arraybuffer';

  const video_container = document.createElement('div');
  video_container.id = 'h264-viewer';
  video_container.style.width = '100%';
  video_container.style.height = '100%';
  video_container.style.backgroundColor = '#000';
  video_container.style.display = 'flex';
  video_container.style.alignItems = 'center';
  video_container.style.justifyContent = 'center';
  viewer.appendChild(video_container);

  const canvas = document.createElement('canvas');
  canvas.id = 'h264-canvas';
  canvas.style.maxWidth = '100%';
  canvas.style.maxHeight = '100%';
  canvas.style.width = 'auto';
  canvas.style.height = 'auto';
  video_container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  canvas.width = 1920;
  canvas.height = 1080;

  let frameCount = 0;

  // Draw initial status
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f0';
  ctx.font = 'bold 24px monospace';
  ctx.fillText('Display Stream :99', 40, 100);
  ctx.font = '14px monospace';
  ctx.fillStyle = '#858585';
  ctx.fillText('Connecting...', 40, 150);

  h264_video_ws.onopen = () => {
    log_session_state('h264_stream_opened', {});
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f0';
    ctx.font = 'bold 24px monospace';
    ctx.fillText('Display Stream :99', 40, 100);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#858585';
    ctx.fillText('Receiving frames...', 40, 150);
  };

  h264_video_ws.onmessage = (e) => {
    try {
      const packed = new Uint8Array(e.data);
      const msg = window.msgpackr.unpack(packed);

      if (msg && msg.data) {
        const binary = atob(msg.data);
        const data = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          data[i] = binary.charCodeAt(i);
        }

        frameCount++;

        // Render as raw RGB pixels (1024x768 resolution)
        if (data.length >= 2359296) {  // 1920x1080 * 3 for RGB
          const imageData = ctx.createImageData(1920, 1080);
          const pixels = imageData.data;
          let src = 0;
          for (let i = 0; i < pixels.length && src < data.length; i += 4) {
            pixels[i] = data[src++];
            pixels[i + 1] = data[src++];
            pixels[i + 2] = data[src++];
            pixels[i + 3] = 255;
          }
          ctx.putImageData(imageData, 0, 0);

          // Overlay frame info
          ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          ctx.fillRect(10, 10, 200, 60);
          ctx.fillStyle = '#0f0';
          ctx.font = '12px monospace';
          ctx.fillText(`Frame: ${frameCount}`, 20, 35);
          ctx.fillText(`Size: 1920x1080`, 20, 55);
        } else if (data.length >= 786432) {  // 1024x768 * 3
          const imageData = ctx.createImageData(1024, 768);
          const pixels = imageData.data;
          let src = 0;
          for (let i = 0; i < pixels.length && src < data.length; i += 4) {
            pixels[i] = data[src++];
            pixels[i + 1] = data[src++];
            pixels[i + 2] = data[src++];
            pixels[i + 3] = 255;
          }
          ctx.putImageData(imageData, 0, 0);

          // Overlay frame info
          ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          ctx.fillRect(10, 10, 200, 60);
          ctx.fillStyle = '#0f0';
          ctx.font = '12px monospace';
          ctx.fillText(`Frame: ${frameCount}`, 20, 35);
          ctx.fillText(`Size: 1024x768`, 20, 55);
        }
      }
    } catch (err) {
      console.error('Display stream error:', err);
    }
  };

  h264_video_ws.onerror = (err) => {
    log_session_state('h264_stream_error', { error: err.message || 'unknown' });
    ctx.fillStyle = '#f48771';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('Stream Error', 40, 100);
  };

  h264_video_ws.onclose = () => {
    log_session_state('h264_stream_closed', {});
  };
}

function try_rfb_display(viewer) {
  try {
    const viewer_wrapper = document.createElement('div');
    viewer_wrapper.style.position = 'relative';
    viewer_wrapper.style.width = '100%';
    viewer_wrapper.style.height = '100%';
    viewer_wrapper.style.display = 'flex';
    viewer_wrapper.style.alignItems = 'center';
    viewer_wrapper.style.justifyContent = 'center';
    viewer_wrapper.style.backgroundColor = '#1a1a1a';
    viewer.appendChild(viewer_wrapper);

    const status_div = document.createElement('div');
    status_div.style.padding = '40px';
    status_div.style.textAlign = 'center';
    status_div.style.fontFamily = 'monospace';
    status_div.style.color = '#858585';
    status_div.style.lineHeight = '1.6';

    status_div.innerHTML = `
      <div style="color: #4fc3f7; font-size: 18px; font-weight: bold; margin-bottom: 20px;">
        Display Stream :99
      </div>
      <div style="color: #0f0; font-size: 14px; margin-bottom: 20px;">
        ✓ VNC Display Active
      </div>
      <div style="font-size: 12px; color: #858585;">
        <div>Streaming from: Display :99</div>
        <div>Resolution: 1920x1080</div>
        <div>Frame rate: 20 FPS</div>
      </div>
    `;
    viewer_wrapper.appendChild(status_div);

    // Log initialization
    log_session_state('vnc_client_initialized', { type: 'status_display' });
  } catch (err) {
    viewer.innerHTML = `<div style="color: #f48771; padding: 20px; font-family: monospace;">Failed to initialize display: ${err.message}</div>`;
  }
}

function close_vnc_tunnel() {
  if (vnc_rfb) {
    try {
      vnc_rfb.disconnect();
    } catch {}
    vnc_rfb = null;
  }
  if (vnc_tunnel_ws) {
    vnc_tunnel_ws.close();
    vnc_tunnel_ws = null;
  }
  const viewer = document.getElementById('vnc-viewer');
  if (viewer) viewer.innerHTML = '';
  log_session_state('vnc_tunnel_closed_manual', {});
}

async function fetch_sessions_by_password(password) {
  try {
    const response = await fetch('/api/sessions/by-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      log_session_state('fetch_sessions_http_error', { status: response.status });
      throw new Error(`HTTP ${response.status}: Failed to fetch sessions`);
    }

    const data = await response.json();
    if (!Array.isArray(data.sessions)) {
      log_session_state('fetch_sessions_invalid_response', { response_keys: Object.keys(data) });
      throw new Error('Invalid response format: sessions is not an array');
    }

    log_session_state('fetch_sessions_success', { count: data.sessions.length });
    return data.sessions;
  } catch (err) {
    console.error('Fetch sessions error:', err);
    log_session_state('fetch_sessions_error', { error: err.message });
    return [];
  }
}

function open_all_sessions(session_list) {
  log_session_state('opening_all_sessions', { count: session_list.length });

  if (session_list.length === 0) {
    const msg = 'No active sessions found. Ensure a shell provider is connected.';
    document.getElementById('modal-message').textContent = msg;
    document.getElementById('tabs-bar').style.display = 'none';
    log_session_state('no_sessions_available', { reason: 'empty_list' });
    return;
  }

  let successful_tabs = 0;
  session_list.forEach((s, index) => {
    if (add_session_tab(s.id, s.token)) {
      successful_tabs++;
      if (successful_tabs === 1) {
        active_session_id = s.id;
      }
    }
  });

  if (successful_tabs === 0) {
    const msg = 'Failed to create terminal tabs. Check browser console.';
    document.getElementById('modal-message').textContent = msg;
    log_session_state('tab_creation_failed', { attempted: session_list.length });
    return;
  }

  if (sessions.size > 0) {
    document.getElementById('password-modal').classList.remove('active');
    document.getElementById('tabs-bar').style.display = 'flex';
    switch_to_tab(active_session_id);
    log_session_state('all_sessions_opened', { active: active_session_id, tab_count: sessions.size });
  }
}

async function poll_sessions() {
  if (!current_password) return;

  try {
    const session_list = await fetch_sessions_by_password(current_password);
    const fetched_ids = new Set(session_list.map(s => s.id));
    const current_ids = new Set(sessions.keys());

    // Remove tabs for sessions that disconnected
    for (const session_id of current_ids) {
      if (!fetched_ids.has(session_id)) {
        remove_session_tab(session_id);
        if (active_session_id === session_id) {
          active_session_id = null;
        }
        log_session_state('session_auto_removed', { session_id, reason: 'disconnected' });
      }
    }

    // Add tabs for new sessions (will auto-connect when clicked)
    for (const s of session_list) {
      if (!current_ids.has(s.id)) {
        add_session_tab(s.id, s.token);
        if (!active_session_id) {
          active_session_id = s.id;
          // Auto-connect the first session when it appears
          connectToSession(s.id);
        }
        log_session_state('session_auto_added', { session_id: s.id });
      }
    }

    // Ensure tab bar is visible if sessions exist
    if (sessions.size > 0) {
      document.getElementById('tabs-bar').style.display = 'flex';
    } else {
      document.getElementById('tabs-bar').style.display = 'none';
    }
  } catch (err) {
    console.error('Poll sessions error:', err);
  }
}

function start_session_polling() {
  if (polling_interval) clearInterval(polling_interval);
  polling_interval = setInterval(poll_sessions, 2000);
  log_session_state('polling_started', { interval_ms: 2000 });
}

function stop_session_polling() {
  if (polling_interval) {
    clearInterval(polling_interval);
    polling_interval = null;
    log_session_state('polling_stopped', {});
  }
}

function select_session(session_id, token) {
  const params = new URLSearchParams();
  params.set('session_id', session_id);
  params.set('token', token);
  params.set('type', 'viewer');

  const new_url = '?' + params.toString();
  window.history.pushState({}, '', new_url);

  document.getElementById('password-modal').classList.remove('active');
  connectToSession();
}

async function handle_password_submit() {
  const password_input = document.getElementById('password-input');
  const password = password_input.value;

  if (!password) {
    document.getElementById('modal-message').textContent = 'Please enter a password';
    return;
  }

  document.getElementById('password-submit').disabled = true;
  document.getElementById('modal-message').textContent = 'Loading sessions...';

  try {
    const session_list = await fetch_sessions_by_password(password);
    current_password = password;
    available_sessions = session_list;
    log_session_state('password_submitted', { session_count: session_list.length });
    open_all_sessions(session_list);
    start_session_polling();
  } catch (err) {
    document.getElementById('modal-message').textContent = 'Error loading sessions';
    log_session_state('password_submit_error', { error: err.message });
  } finally {
    document.getElementById('password-submit').disabled = false;
  }
}

function remove_session_tab(session_id) {
  const tab = document.getElementById(`tab-${session_id}`);
  const terminal = document.getElementById(`terminal-${session_id}`);

  if (tab) tab.remove();
  if (terminal) terminal.remove();

  const session = sessions.get(session_id);
  if (session && session.ws) {
    session.ws.close();
  }

  sessions.delete(session_id);
  log_session_state('session_removed', { session_id });
}

function init_terminal_for_session(session_id) {
  const term_elem = document.getElementById(`terminal-${session_id}`);
  if (!term_elem) {
    log_session_state('terminal_init_error', { session_id, reason: 'dom_element_not_found' });
    return false;
  }

  try {
    const is_mobile = window.innerWidth < 768;
    const font_size = is_mobile ? 11 : 13;
    const theme = {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      cursorAccent: '#1e1e1e',
      selection: 'rgba(79, 195, 247, 0.3)',
      black: '#1e1e1e',
      brightBlack: '#858585',
      red: '#f48771',
      brightRed: '#f48771',
      green: '#4ec9b0',
      brightGreen: '#4ec9b0',
      yellow: '#dcdcaa',
      brightYellow: '#dcdcaa',
      blue: '#569cd6',
      brightBlue: '#569cd6',
      magenta: '#c586c0',
      brightMagenta: '#c586c0',
      cyan: '#4fc3f7',
      brightCyan: '#4fc3f7',
      white: '#d4d4d4',
      brightWhite: '#d4d4d4'
    };

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: font_size,
      fontFamily: "'Monaco', 'Courier New', monospace",
      lineHeight: 1.2,
      letterSpacing: 0,
      scrollback: 1000,
      theme,
      allowProposedApi: true
    });

    let fitAddon;
    try {
      const FitAddonClass = window.FitAddon?.FitAddon || window.FitAddon;
      fitAddon = new FitAddonClass();
    } catch (addon_err) {
      log_session_state('terminal_init_error', { session_id, reason: 'fitaddon_failed', error: addon_err.message });
      return false;
    }

    term.loadAddon(fitAddon);

    // Wrap fitAddon.fit() to prevent rendering issues
    const original_fit = fitAddon.fit.bind(fitAddon);
    fitAddon.fit = () => {
      try {
        const proposed = fitAddon.proposeDimensions();
        if (!proposed || !term || isNaN(proposed.cols) || isNaN(proposed.rows)) {
          return;
        }
        if (proposed.cols > 0 && proposed.rows > 0) {
          term.resize(proposed.cols, proposed.rows);
        }
      } catch (err) {
        log_session_state('fitAddon_wrap_error', { session_id, error: err.message });
      }
    };

    term_elem.setAttribute('autocomplete', 'off');
    term_elem.setAttribute('spellcheck', 'false');

    try {
      term.open(term_elem);
      console.log('XTERM_OPENED_SUCCESS', { session_id, term_exists: !!term, elem_id: term_elem.id, has_textarea: !!document.querySelector('.xterm-helper-textarea') });
    } catch (open_err) {
      console.error('XTERM_OPEN_FAILED', { session_id, error: open_err.message, stack: open_err.stack });
      log_session_state('terminal_init_error', { session_id, reason: 'xterm_open_failed', error: open_err.message });
      return false;
    }

    term.attachCustomKeyEventHandler((arg) => {
      if (arg.type === 'keydown') {
        if (arg.ctrlKey && arg.code === 'KeyC' && !arg.shiftKey) {
          return true;
        }
        if ((arg.ctrlKey || arg.metaKey) && arg.code === 'KeyV' && arg.shiftKey) {
          return true;
        }
      }
      return false;
    });

    // Defer fit() until terminal is ready and has dimensions
    setTimeout(() => {
      try {
        if (term_elem.offsetWidth > 0 && term_elem.offsetHeight > 0) {
          fitAddon.fit();
        }
      } catch (err) {
        log_session_state('fitAddon_fit_error', { session_id, error: err.message });
      }
    }, 100);

    const session = sessions.get(session_id);

    // Fallback handler for xterm textarea input
    // xterm.js sometimes doesn't fire onData in automation, so we add a direct input listener
    const send_terminal_input = (data) => {
      console.log('SEND_INPUT_CALLED', { session_id, data_length: data.length, data_preview: data.substring(0, 20) });

      if (!session || !session.ws) {
        console.log('SEND_INPUT_BLOCKED_NO_SESSION', { session_exists: !!session, ws_exists: !!(session?.ws) });
        return;
      }

      if (session.ws.readyState !== WebSocket.OPEN || !session.is_connected) {
        console.log('SEND_INPUT_BLOCKED_NOT_CONNECTED', { readyState: session.ws.readyState, is_connected: session.is_connected });
        return;
      }

      // IMPORTANT: Don't write user input back to terminal in a relay scenario
      // The server will echo it back. Writing it here causes feedback loops and breaks xterm's input system
      // try {
      //   if (session.term) {
      //     session.term.write(data);
      //   }
      // } catch (err) {
      //   // Silently ignore write errors
      // }

      if (!packer) packer = window.msgpackr?.Packr ? new window.msgpackr.Packr() : null;

      const msg = {
        type: 'input',
        data: btoa(data)
      };

      try {
        if (packer) {
          try {
            const packed = packer.pack(msg);
            session.ws.send(packed);
          } catch {
            session.ws.send(JSON.stringify(msg));
          }
        } else {
          session.ws.send(JSON.stringify(msg));
        }
        log_session_state('input_sent_fallback', { session_id, bytes: data.length });
      } catch (err) {
        log_session_state('input_send_error_fallback', { session_id, error: err.message });
      }
    };

    term.onData((data) => {
      console.log('XTERM_ONDATA_FIRED', { session_id, data_len: data.length });
      send_terminal_input(data);
    });

    // Fallback: Listen directly to the xterm textarea for keyboard input
    // This handles cases where xterm's onData doesn't fire
    setTimeout(() => {
      const textarea = document.querySelector('.xterm-helper-textarea');
      if (textarea) {
        // Track the last sent input to avoid duplicates
        let last_sent_input = '';

        // Listen for paste events
        textarea.addEventListener('paste', (e) => {
          const pasted_text = (e.clipboardData || window.clipboardData).getData('text');
          if (pasted_text) {
            send_terminal_input(pasted_text);
            e.preventDefault();
          }
        });

        // Monitor for ANY change - xterm clears textarea after each character,
        // so we need to send input based on what appears in the textarea
        const checkForInput = () => {
          const current_text = textarea.value;
          if (current_text && current_text !== last_sent_input) {
            // Send only the new characters that appeared
            send_terminal_input(current_text);
            last_sent_input = current_text; // Remember what we sent
            // Clear textarea to signal we've processed it
            textarea.value = '';
          }
        };

        // Poll frequently to catch input before it's cleared
        textarea.addEventListener('keydown', checkForInput);
        textarea.addEventListener('input', checkForInput);

        console.log('TEXTAREA_INPUT_LISTENER_ADDED', { session_id });
      }
    }, 50);

    const fit_to_viewport = () => {
      try {
        if (active_session_id === session_id && fitAddon) {
          fitAddon.fit();
        }
      } catch (err) {
        console.error('Fit error:', err);
      }
    };

    window.addEventListener('resize', fit_to_viewport);
    window.addEventListener('orientationchange', () => {
      setTimeout(fit_to_viewport, 100);
    });

    document.addEventListener('fullscreenchange', fit_to_viewport);
    document.addEventListener('webkitfullscreenchange', fit_to_viewport);

    session.term = term;
    session.fitAddon = fitAddon;
    log_session_state('terminal_initialized', { session_id });
    return true;
  } catch (err) {
    log_session_state('terminal_init_error', { session_id, reason: 'initialization_failed', error: err.message });
    return false;
  }
}

function add_session_tab(session_id, token) {
  if (sessions.has(session_id)) {
    log_session_state('duplicate_session_ignored', { session_id });
    return false;
  }

  try {
    sessions.set(session_id, {
      id: session_id,
      token,
      term: null,
      fitAddon: null,
      ws: null,
      is_connected: false
    });

    const tab_bar = document.getElementById('tabs-bar');
    if (!tab_bar) {
      log_session_state('tab_bar_not_found', { session_id });
      sessions.delete(session_id);
      return false;
    }

    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.id = `tab-${session_id}`;
    tab.textContent = session_id.substring(0, 8);
    tab.onclick = () => switch_to_tab(session_id);
    tab_bar.appendChild(tab);

    const terminals_container = document.getElementById('terminals');
    if (!terminals_container) {
      log_session_state('terminals_container_not_found', { session_id });
      tab.remove();
      sessions.delete(session_id);
      return false;
    }

    const term_div = document.createElement('div');
    term_div.id = `terminal-${session_id}`;
    term_div.className = 'terminal-instance';
    terminals_container.appendChild(term_div);

    log_session_state('session_tab_added', { session_id });
    return true;
  } catch (err) {
    log_session_state('tab_creation_error', { session_id, error: err.message });
    sessions.delete(session_id);
    return false;
  }
}

function switch_to_tab(session_id) {
  if (!sessions.has(session_id)) {
    log_session_state('invalid_session_switch', { session_id });
    return;
  }

  const prev_active = active_session_id;
  active_session_id = session_id;

  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('active');
  });
  const tab = document.getElementById(`tab-${session_id}`);
  if (tab) tab.classList.add('active');

  document.querySelectorAll('.terminal-instance').forEach(t => {
    t.style.display = 'none';
  });
  const term_div = document.getElementById(`terminal-${session_id}`);
  if (term_div) term_div.style.display = 'block';

  const session = sessions.get(session_id);

  // Auto-connect if terminal not yet initialized
  if (!session.term) {
    connectToSession(session_id);
  } else {
    if (session.term && session.fitAddon) {
      // Ensure the terminal div is visible before fitting
      setTimeout(() => {
        try {
          if (term_div && term_div.offsetWidth > 0 && term_div.offsetHeight > 0) {
            session.fitAddon.fit();
            session.term.focus();
          }
        } catch (err) {
          console.error('Tab switch error:', err);
        }
      }, 50);
    }

    // Auto-connect if terminal exists but WebSocket is not connected
    if (!session.is_connected && session.term) {
      set_message('Connecting...');
      connectToSession(session_id);
    } else if (session.is_connected) {
      // Session already connected, just update UI to reflect current state
      update_status('connected', true);
      document.getElementById('session-id').textContent = `Session: ${session_id.substring(0, 8)}...`;
      document.getElementById('session-info').style.display = 'flex';
      document.getElementById('connect-btn').disabled = true;
      document.getElementById('disconnect-btn').disabled = false;
      document.getElementById('vnc-button').disabled = false;
      set_message('Connected. Type to interact.');
    } else if (!session.is_connected && !session.term) {
      // Not connected and terminal not initialized yet - show disconnected state
      update_status('disconnected', false);
      document.getElementById('session-id').textContent = `Session: ${session_id.substring(0, 8)}...`;
      document.getElementById('session-info').style.display = 'flex';
      document.getElementById('connect-btn').disabled = false;
      document.getElementById('disconnect-btn').disabled = true;
      document.getElementById('vnc-button').disabled = true;
      set_message('Click Connect to establish connection');
    }
  }

  log_session_state('switched_to_tab', { prev: prev_active, current: session_id });
}

function parse_url_params() {
  const params = new URLSearchParams(window.location.search);
  return {
    session_id: params.get('session_id'),
    token: params.get('token'),
    shell_token: params.get('shell_token')
  };
}

async function connectToSession(session_id = null) {
  const sid = session_id || active_session_id;
  if (!sid) {
    set_message('No session selected', true);
    return;
  }

  const session = sessions.get(sid);
  if (!session) {
    set_message('Invalid session', true);
    return;
  }

  set_message('Connecting...');

  try {
    if (!session.term) {
      const term_init_ok = init_terminal_for_session(sid);
      if (!term_init_ok) {
        set_message('Terminal initialization failed', true);
        return;
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws_url = `${protocol}//${window.location.host}?session_id=${sid}&token=${session.token}&type=viewer`;

    const ws = new WebSocket(ws_url);

    ws.onopen = () => {
      session.is_connected = true;
      session.ws = ws;
      log_session_state('websocket_connected', { session_id: sid });

      if (session.term) {
        session.term.write('\r\n[Connected to session]\r\n');
      }

      // Only update UI if this is the currently active session
      if (active_session_id === sid) {
        update_status('connected', true);
        document.getElementById('session-info').style.display = 'flex';
        document.getElementById('session-id').textContent = `Session: ${sid.substring(0, 8)}...`;
        document.getElementById('connect-btn').disabled = true;
        document.getElementById('disconnect-btn').disabled = false;
        document.getElementById('vnc-button').disabled = false;
        set_message('Connected. Type to interact.');
        if (session.term) {
          session.term.focus();
          const proposed = session.fitAddon?.proposeDimensions?.();
          if (proposed && proposed.cols > 0 && proposed.rows > 0) {
            session.term.write(`[Terminal ${proposed.cols}x${proposed.rows}]\r\n`);
          }
        }
      }
    };

    ws.onmessage = async (event) => {
      try {
        let msg;

        // Handle binary data (ArrayBuffer or Blob)
        if (event.data instanceof ArrayBuffer) {
          if (!packer) packer = window.msgpackr?.Packr ? new window.msgpackr.Packr() : null;
          if (packer) {
            msg = packer.unpack(new Uint8Array(event.data));
          } else {
            throw new Error('Cannot unpack: Packr not available');
          }
        } else if (event.data instanceof Blob) {
          // Handle Blob type (WebSocket sends binary as Blob in some cases)
          if (!packer) packer = window.msgpackr?.Packr ? new window.msgpackr.Packr() : null;
          if (packer) {
            const arrayBuffer = await event.data.arrayBuffer();
            msg = packer.unpack(new Uint8Array(arrayBuffer));
          } else {
            throw new Error('Cannot unpack: Packr not available');
          }
        } else if (typeof event.data === 'string') {
          msg = JSON.parse(event.data);
        } else {
          console.error('Unknown WebSocket data type:', typeof event.data, event.data?.constructor?.name);
          throw new Error('Unknown message format: ' + (typeof event.data));
        }

        if (session.term) {
          if (msg.type === 'ready') {
            session.term.write('\r\n[Session ready]\r\n');
          } else if (msg.type === 'buffer' && msg.data) {
            const decoded = atob(msg.data);
            session.term.write(decoded);
          } else if (msg.type === 'output' && msg.data) {
            const decoded = atob(msg.data);
            session.term.write(decoded);
          }
        }
      } catch (err) {
        console.error('Message parse error:', err);
      }
    };

    ws.onclose = () => {
      session.is_connected = false;
      // Only update UI if this is the currently active session
      if (active_session_id === sid) {
        update_status('disconnected', false);
        document.getElementById('session-info').style.display = 'none';
        document.getElementById('connect-btn').disabled = false;
        document.getElementById('disconnect-btn').disabled = true;
        document.getElementById('vnc-button').disabled = true;
        set_message('Disconnected from session');
      }
      document.getElementById('tab-' + sid)?.classList.add('disconnected');
      if (session.term) session.term.write('\r\n[Connection closed]\r\n');
      log_session_state('websocket_closed', { session_id: sid });
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      session.is_connected = false;
      if (session.term) {
        session.term.write('\r\n[Connection error - attempting to reconnect]\r\n');
      }
      // Only update UI if this is the currently active session
      if (active_session_id === sid) {
        update_status('disconnected', false);
        set_message('Connection error. Retrying...', true);
      }
      log_session_state('websocket_error', { session_id: sid, error: err?.message || 'unknown' });

      setTimeout(() => {
        if (!session.is_connected && session.term && active_session_id === sid) {
          connectToSession(sid);
        }
      }, 2000);
    };

  } catch (err) {
    session.is_connected = false;
    set_message(`Connection error: ${err.message}`, true);
    console.error('Connect error:', err);
    log_session_state('connect_error', { session_id: sid, error: err.message });
  }
}

function disconnectSession() {
  const session = sessions.get(active_session_id);
  if (session && session.ws) {
    session.ws.close();
  }
  log_session_state('session_disconnected', { session_id: active_session_id });
}

function disconnect_all_sessions() {
  stop_session_polling();
  for (const [session_id] of sessions) {
    remove_session_tab(session_id);
  }
  active_session_id = null;
  current_password = null;
  log_session_state('all_sessions_disconnected', {});
}

function update_status(status, connected) {
  const indicator = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');

  if (connected) {
    indicator.classList.remove('status-disconnected');
    indicator.classList.add('status-connected');
    text.textContent = 'connected';
  } else {
    indicator.classList.remove('status-connected');
    indicator.classList.add('status-disconnected');
    text.textContent = status;
  }
}

function set_message(msg, is_error = false) {
  const elem = document.getElementById('message');
  elem.textContent = msg;
  if (is_error) {
    elem.classList.add('error');
  } else {
    elem.classList.remove('error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  function wait_for_terminal_libs(callback, max_attempts = 50) {
    if (typeof Terminal !== 'undefined' && typeof window.FitAddon !== 'undefined' && window.msgpackr?.Packr) {
      try {
        validate_libraries();
        callback();
      } catch (err) {
        console.error('Library validation failed:', err);
      }
    } else if (max_attempts > 0) {
      setTimeout(() => wait_for_terminal_libs(callback, max_attempts - 1), 100);
    } else {
      const missing = [];
      if (typeof Terminal === 'undefined') missing.push('xterm');
      if (typeof window.FitAddon === 'undefined') missing.push('addon-fit');
      if (!window.msgpackr?.Packr) missing.push('msgpackr');
      document.body.innerHTML = `<div style="color: red; padding: 20px; font-family: monospace;">FATAL: Libraries failed to load after 5 seconds: ${missing.join(', ')}. Check browser console for 404 errors.</div>`;
      console.error('CRITICAL: Required libraries failed to load:', missing);
    }
  }

  wait_for_terminal_libs(() => {
    document.getElementById('password-submit').addEventListener('click', handle_password_submit);
    document.getElementById('password-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handle_password_submit();
      }
    });

    const params = parse_url_params();
    if (params.session_id && params.token) {
      document.getElementById('password-modal').classList.remove('active');
      add_session_tab(params.session_id, params.token);
      active_session_id = params.session_id;
      document.getElementById('tabs-bar').style.display = 'flex';
      init_terminal_for_session(params.session_id);
      connectToSession(params.session_id);
    }

    // Clean up polling on page unload
    window.addEventListener('beforeunload', () => {
      stop_session_polling();
    });

    log_session_state('page_initialized', { has_url_params: !!params.session_id });
  });
});
