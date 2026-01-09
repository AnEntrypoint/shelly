let term;
let fitAddon;
let ws;
let is_connected = false;
let current_session = null;
let current_password = null;
let available_sessions = [];

async function fetch_sessions_by_password(password) {
  try {
    const response = await fetch('/api/sessions/by-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      throw new Error('Failed to fetch sessions');
    }

    const data = await response.json();
    return data.sessions || [];
  } catch (err) {
    console.error('Fetch sessions error:', err);
    return [];
  }
}

function display_sessions(sessions) {
  const list = document.getElementById('sessions-list');
  const msg = document.getElementById('modal-message');

  if (sessions.length === 0) {
    msg.textContent = 'No active sessions found';
    list.innerHTML = '';
    return;
  }

  msg.textContent = `Found ${sessions.length} active session(s)`;
  list.innerHTML = sessions.map(s => `
    <div class="session-item" onclick="select_session('${s.id}', '${s.token}')">
      <div class="session-item-id">Session: ${s.id.substring(0, 12)}...</div>
      <div class="session-item-info">
        Clients: ${s.clients} | Uptime: ${Math.floor(s.uptime_ms / 1000)}s
      </div>
    </div>
  `).join('');
}

function select_session(session_id, token) {
  const params = new URLSearchParams();
  params.set('session_id', session_id);
  params.set('token', token);
  params.set('type', 'viewer');

  window.location.search = params.toString();
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
    const sessions = await fetch_sessions_by_password(password);
    current_password = password;
    available_sessions = sessions;
    display_sessions(sessions);
  } catch (err) {
    document.getElementById('modal-message').textContent = 'Error loading sessions';
  } finally {
    document.getElementById('password-submit').disabled = false;
  }
}

function init_terminal() {
  const is_mobile = window.innerWidth < 768;
  const font_size = is_mobile ? 11 : 13;

  term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: font_size,
    fontFamily: "'Monaco', 'Courier New', monospace",
    lineHeight: 1.2,
    letterSpacing: 0,
    scrollback: 1000,
    theme: {
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
    },
    allowProposedApi: true
  });

  fitAddon = new window.FitAddon();
  term.loadAddon(fitAddon);

  const term_elem = document.getElementById('terminal');
  term_elem.setAttribute('autocomplete', 'off');
  term_elem.setAttribute('spellcheck', 'false');

  term.open(term_elem);
  fitAddon.fit();

  term.onData((data) => {
    if (is_connected && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'input',
        data: btoa(data)
      }));
    }
  });

  const fit_to_viewport = () => {
    try {
      fitAddon.fit();
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

  update_status('disconnected', false);
  set_message('Ready to connect. Click "Connect" or pass session params in URL.');
}

function parse_url_params() {
  const params = new URLSearchParams(window.location.search);
  return {
    session_id: params.get('session_id'),
    token: params.get('token'),
    shell_token: params.get('shell_token')
  };
}

async function connectToSession() {
  const params = parse_url_params();

  if (!params.session_id || !params.token) {
    set_message('Missing session_id or token in URL', true);
    return;
  }

  set_message('Connecting...');
  document.getElementById('connect-btn').disabled = true;

  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws_url = `${protocol}//${window.location.host}?session_id=${params.session_id}&token=${params.token}&type=viewer`;

    ws = new WebSocket(ws_url);

    ws.onopen = () => {
      is_connected = true;
      current_session = params.session_id;
      update_status('connected', true);
      document.getElementById('session-info').style.display = 'flex';
      document.getElementById('session-id').textContent = `Session: ${params.session_id.substring(0, 8)}...`;
      document.getElementById('connect-btn').disabled = true;
      document.getElementById('disconnect-btn').disabled = false;
      set_message('Connected. Type to interact.');
      term.focus();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'ready') {
          term.write('\r\n[Session ready]\r\n');
        } else if (msg.type === 'buffer' && msg.data) {
          const decoded = atob(msg.data);
          term.write(decoded);
        } else if (msg.type === 'output' && msg.data) {
          const decoded = atob(msg.data);
          term.write(decoded);
        }
      } catch (err) {
        console.error('Message parse error:', err);
      }
    };

    ws.onclose = () => {
      is_connected = false;
      update_status('disconnected', false);
      document.getElementById('session-info').style.display = 'none';
      document.getElementById('connect-btn').disabled = false;
      document.getElementById('disconnect-btn').disabled = true;
      set_message('Disconnected from session');
      term.write('\r\n[Connection closed]\r\n');
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      set_message('Connection error', true);
      is_connected = false;
      update_status('disconnected', false);
    };
  } catch (err) {
    set_message(`Error: ${err.message}`, true);
    console.error('Connect error:', err);
    document.getElementById('connect-btn').disabled = false;
  }
}

function disconnectSession() {
  if (ws) {
    ws.close();
  }
  is_connected = false;
  update_status('disconnected', false);
  document.getElementById('connect-btn').disabled = false;
  document.getElementById('disconnect-btn').disabled = true;
  set_message('Disconnected');
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
    if (typeof Terminal !== 'undefined' && typeof window.FitAddon !== 'undefined') {
      callback();
    } else if (max_attempts > 0) {
      setTimeout(() => wait_for_terminal_libs(callback, max_attempts - 1), 100);
    } else {
      console.error('Timeout: xterm libraries failed to load');
    }
  }

  wait_for_terminal_libs(() => {
    init_terminal();

    const params = parse_url_params();

    document.getElementById('password-submit').addEventListener('click', handle_password_submit);
    document.getElementById('password-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handle_password_submit();
      }
    });

    if (params.session_id && params.token) {
      document.getElementById('password-modal').classList.remove('active');
      connectToSession();
    }
  });
});
