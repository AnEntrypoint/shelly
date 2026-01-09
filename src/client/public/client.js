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
let h264_decoder = null;
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

function toggle_vnc_modal() {
  const modal = document.getElementById('vnc-modal');
  modal.classList.toggle('active');
  if (modal.classList.contains('active')) {
    init_h264_video_stream();
  } else {
    close_h264_video_stream();
  }
}

function init_h264_video_stream() {
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
  const video_url = `${protocol}//${window.location.host}/api/vnc-video?session_id=${active_session_id}&token=${session.token}&fps=5`;

  try {
    h264_video_ws = new WebSocket(video_url);
    h264_video_ws.binaryType = 'arraybuffer';

    h264_video_ws.onopen = () => {
      log_session_state('h264_stream_opened', { url: video_url });
    };

    h264_video_ws.onmessage = (event) => {
      try {
        if (!packer) packer = window.msgpackr?.Packr ? new window.msgpackr.Packr() : null;

        if (packer && event.data instanceof ArrayBuffer) {
          const msg = packer.unpack(new Uint8Array(event.data));

          if (msg.type === 'ready' && msg.stream_type === 'h264_video') {
            log_session_state('h264_stream_ready', {
              width: msg.width,
              height: msg.height,
              fps: msg.fps
            });
            init_h264_video_player(msg.width, msg.height);
          } else if (msg.type === 'h264_chunk' && msg.data) {
            const chunk = Buffer.from(msg.data, 'base64');
            if (h264_decoder) {
              h264_decoder.decode(chunk);
            }
          }
        }
      } catch (err) {
        log_session_state('h264_message_error', { error: err.message });
      }
    };

    h264_video_ws.onclose = () => {
      log_session_state('h264_stream_closed', {});
      close_h264_video_stream();
    };

    h264_video_ws.onerror = (err) => {
      log_session_state('h264_stream_error', { error: err.message });
    };
  } catch (err) {
    log_session_state('h264_stream_init_error', { error: err.message });
    alert(`H.264 stream error: ${err.message}`);
  }
}

function init_h264_video_player(width, height) {
  const viewer = document.getElementById('vnc-viewer');
  viewer.innerHTML = '';

  try {
    const video_container = document.createElement('div');
    video_container.style.position = 'relative';
    video_container.style.width = '100%';
    video_container.style.height = '100%';
    viewer.appendChild(video_container);

    const video_elem = document.createElement('video');
    video_elem.id = 'h264-video-player';
    video_elem.style.width = '100%';
    video_elem.style.height = '100%';
    video_elem.style.backgroundColor = '#000';
    video_elem.style.display = 'block';
    video_elem.autoplay = true;
    video_elem.muted = true;
    video_container.appendChild(video_elem);

    const overlay = document.createElement('div');
    overlay.id = 'h264-overlay';
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.userSelect = 'text';
    overlay.style.WebkitUserSelect = 'text';
    overlay.style.MozUserSelect = 'text';
    overlay.style.msUserSelect = 'text';
    overlay.style.cursor = 'default';
    overlay.style.zIndex = '1';
    overlay.textContent = 'H.264 video stream active - select text to copy';
    overlay.style.color = 'rgba(255, 255, 255, 0.3)';
    overlay.style.fontSize = '12px';
    overlay.style.padding = '10px';
    overlay.style.pointerEvents = 'auto';
    video_container.appendChild(overlay);

    if (window.H264Decoder) {
      h264_decoder = new window.H264Decoder();
      h264_decoder.onPictureDecoded = (buffer, width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(buffer);
        ctx.putImageData(imageData, 0, 0);

        const video = document.getElementById('h264-video-player');
        if (video) {
          video.style.backgroundImage = `url(${canvas.toDataURL()})`;
          video.style.backgroundSize = 'contain';
          video.style.backgroundPosition = 'center';
        }
      };

      log_session_state('h264_decoder_initialized', { width, height });
    } else {
      log_session_state('h264_decoder_unavailable', { info: 'Using fallback display' });
    }
  } catch (err) {
    log_session_state('h264_player_init_error', { error: err.message });
    viewer.innerHTML = `<p style="color: #f48771; padding: 20px;">Failed to initialize H.264 player: ${err.message}</p>`;
  }
}

function close_h264_video_stream() {
  if (h264_video_ws) {
    h264_video_ws.close();
    h264_video_ws = null;
  }
  if (h264_decoder) {
    h264_decoder = null;
  }
  const viewer = document.getElementById('vnc-viewer');
  if (viewer) viewer.innerHTML = '';
  log_session_state('h264_stream_closed_manual', {});
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

function init_novnc_viewer() {
  const viewer = document.getElementById('vnc-viewer');
  viewer.innerHTML = '';

  try {
    const viewer_wrapper = document.createElement('div');
    viewer_wrapper.style.position = 'relative';
    viewer_wrapper.style.width = '100%';
    viewer_wrapper.style.height = '100%';
    viewer.appendChild(viewer_wrapper);

    const rfb = new RFB(viewer_wrapper, vnc_tunnel_ws);
    rfb.addEventListener('connect', () => {
      log_session_state('novnc_connected', {});
    });
    rfb.addEventListener('disconnect', () => {
      log_session_state('novnc_disconnected', {});
    });
    rfb.addEventListener('error', (evt) => {
      log_session_state('novnc_error', { error: evt.detail?.message });
    });

    vnc_rfb = rfb;

    const tunnel_handler = (data) => {
      if (vnc_tunnel_ws && vnc_tunnel_ws.readyState === WebSocket.OPEN) {
        try {
          if (!packer) packer = window.msgpackr?.Packr ? new window.msgpackr.Packr() : null;

          const packed = packer ? packer.pack({
            type: 'vnc_frame',
            session_id: active_session_id,
            data: Buffer.from(data).toString('base64'),
            timestamp: Date.now()
          }) : JSON.stringify({
            type: 'vnc_frame',
            session_id: active_session_id,
            data: Buffer.from(data).toString('base64'),
            timestamp: Date.now()
          });

          vnc_tunnel_ws.send(packed);
          log_session_state('vnc_frame_sent', { bytes: data.length });
        } catch (err) {
          log_session_state('vnc_send_error', { error: err.message });
        }
      }
    };

    rfb._sock.send = tunnel_handler;

    const overlay = document.createElement('div');
    overlay.id = 'vnc-overlay';
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.userSelect = 'text';
    overlay.style.WebkitUserSelect = 'text';
    overlay.style.MozUserSelect = 'text';
    overlay.style.msUserSelect = 'text';
    overlay.style.cursor = 'default';
    overlay.style.zIndex = '100';
    overlay.textContent = 'VNC Display - select text to copy';
    overlay.style.color = 'rgba(255, 255, 255, 0.2)';
    overlay.style.fontSize = '11px';
    overlay.style.padding = '8px';
    overlay.style.pointerEvents = 'none';
    viewer_wrapper.appendChild(overlay);

    log_session_state('novnc_initialized', {});
  } catch (err) {
    log_session_state('novnc_init_error', { error: err.message });
    viewer.innerHTML = `<p style="color: #f48771; padding: 20px;">Failed to initialize VNC viewer: ${err.message}</p>`;
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

    term.onData((data) => {
      // DIAGNOSTIC: Log every input event with exact state
      console.log('INPUT_EVENT', {
        session_id,
        data_length: data.length,
        data_preview: data.substring(0, 50),
        session_exists: !!session,
        ws_exists: !!(session && session.ws),
        ws_readyState: session?.ws?.readyState,
        ws_OPEN: WebSocket.OPEN,
        ws_CLOSED: WebSocket.CLOSED,
        ws_CLOSING: WebSocket.CLOSING,
        session_is_connected: session?.is_connected,
        all_guards_pass: !!(session && session.ws &&
          session.ws.readyState === WebSocket.OPEN &&
          session.is_connected)
      });

      if (!session || !session.ws) {
        set_message('Session error: WebSocket not available', true);
        log_session_state('input_error_no_ws', { session_id, reason: 'ws_missing', session_exists: !!session, ws_exists: !!(session?.ws) });
        return;
      }

      if (session.ws.readyState === WebSocket.CLOSED || session.ws.readyState === WebSocket.CLOSING) {
        set_message('Connection lost. Attempting to reconnect...', false);
        log_session_state('input_ws_closed', { session_id, readyState: session.ws.readyState, CLOSED: WebSocket.CLOSED, CLOSING: WebSocket.CLOSING });
        connectToSession(session_id);
        return;
      }

      if (session.ws.readyState !== WebSocket.OPEN) {
        set_message('Connecting...', false);
        log_session_state('input_ws_not_ready', { session_id, readyState: session.ws.readyState, expected_OPEN: WebSocket.OPEN });
        return;
      }

      if (!session.is_connected) {
        set_message('Reconnecting...', false);
        log_session_state('input_session_not_connected', { session_id, is_connected: session.is_connected });
        connectToSession(session_id);
        return;
      }

      try {
        if (session.term) {
          session.term.write(data);
        }
      } catch (err) {
        log_session_state('term_write_error', { session_id, error: err.message });
      }

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
        log_session_state('input_sent', { session_id, bytes: data.length });
      } catch (err) {
        log_session_state('input_send_error', { session_id, error: err.message });
        set_message('Failed to send input', true);
      }
    });

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
      connectToSession(session_id);
    }

    update_status(session.is_connected ? 'connected' : 'disconnected', session.is_connected);
    if (session.is_connected) {
      document.getElementById('session-id').textContent = `Session: ${session_id.substring(0, 8)}...`;
      document.getElementById('connect-btn').disabled = true;
      document.getElementById('disconnect-btn').disabled = false;
      document.getElementById('vnc-button').disabled = false;
    } else {
      document.getElementById('connect-btn').disabled = false;
      document.getElementById('disconnect-btn').disabled = true;
      document.getElementById('vnc-button').disabled = true;
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

    ws.onmessage = (event) => {
      try {
        let msg;

        if (event.data instanceof ArrayBuffer) {
          if (!packer) packer = window.msgpackr?.Packr ? new window.msgpackr.Packr() : null;
          if (packer) {
            msg = packer.unpack(new Uint8Array(event.data));
          } else {
            throw new Error('Cannot unpack: Packr not available');
          }
        } else if (typeof event.data === 'string') {
          msg = JSON.parse(event.data);
        } else {
          throw new Error('Unknown message format');
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
      update_status('disconnected', false);
      if (active_session_id === sid) {
        document.getElementById('session-info').style.display = 'none';
        document.getElementById('connect-btn').disabled = false;
        document.getElementById('disconnect-btn').disabled = true;
        document.getElementById('vnc-button').disabled = true;
      }
      document.getElementById('tab-' + sid)?.classList.add('disconnected');
      set_message('Disconnected from session');
      if (session.term) session.term.write('\r\n[Connection closed]\r\n');
      log_session_state('websocket_closed', { session_id: sid });
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      session.is_connected = false;
      update_status('disconnected', false);
      if (session.term) {
        session.term.write('\r\n[Connection error - attempting to reconnect]\r\n');
      }
      set_message('Connection error. Retrying...', true);
      log_session_state('websocket_error', { session_id: sid, error: err?.message || 'unknown' });

      setTimeout(() => {
        if (!session.is_connected && session.term) {
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
