const sessions = new Map();
let active_session_id = null;
let current_password = null;
let available_sessions = [];

function log_session_state(causation, details = {}) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    causation,
    active_session: active_session_id,
    session_count: sessions.size,
    details
  }));
}

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

function open_all_sessions(session_list) {
  log_session_state('opening_all_sessions', { count: session_list.length });

  if (session_list.length === 0) {
    document.getElementById('modal-message').textContent = 'No active sessions found';
    document.getElementById('tabs-bar').style.display = 'none';
    return;
  }

  session_list.forEach((s, index) => {
    add_session_tab(s.id, s.token);
    if (index === 0) {
      active_session_id = s.id;
    }
  });

  if (sessions.size > 0) {
    document.getElementById('password-modal').classList.remove('active');
    document.getElementById('tabs-bar').style.display = 'flex';
    switch_to_tab(active_session_id);
    log_session_state('all_sessions_opened', { active: active_session_id });
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
      fitAddon = new window.FitAddon();
    } catch (addon_err) {
      log_session_state('terminal_init_error', { session_id, reason: 'fitaddon_failed', error: addon_err.message });
      return false;
    }

    term.loadAddon(fitAddon);

    term_elem.setAttribute('autocomplete', 'off');
    term_elem.setAttribute('spellcheck', 'false');

    term.open(term_elem);
    fitAddon.fit();

    const session = sessions.get(session_id);
    term.onData((data) => {
      if (session.is_connected && session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({
          type: 'input',
          data: btoa(data)
        }));
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
    return;
  }

  sessions.set(session_id, {
    id: session_id,
    token,
    term: null,
    fitAddon: null,
    ws: null,
    is_connected: false
  });

  const tab_bar = document.getElementById('tabs-bar');
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.id = `tab-${session_id}`;
  tab.textContent = session_id.substring(0, 8);
  tab.onclick = () => switch_to_tab(session_id);
  tab_bar.appendChild(tab);

  const terminals_container = document.getElementById('terminals');
  const term_div = document.createElement('div');
  term_div.id = `terminal-${session_id}`;
  term_div.className = 'terminal-instance';
  terminals_container.appendChild(term_div);

  log_session_state('session_tab_added', { session_id });
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
  if (session.term) {
    try {
      session.fitAddon.fit();
      session.term.focus();
    } catch (err) {
      console.error('Tab switch error:', err);
    }
  }

  update_status(session.is_connected ? 'connected' : 'disconnected', session.is_connected);
  if (session.is_connected) {
    document.getElementById('session-id').textContent = `Session: ${session_id.substring(0, 8)}...`;
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
      update_status('connected', true);
      document.getElementById('session-info').style.display = 'flex';
      document.getElementById('session-id').textContent = `Session: ${sid.substring(0, 8)}...`;
      document.getElementById('connect-btn').disabled = true;
      document.getElementById('disconnect-btn').disabled = false;
      set_message('Connected. Type to interact.');
      if (session.term) session.term.focus();
      log_session_state('websocket_connected', { session_id: sid });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
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
      }
      document.getElementById('tab-' + sid)?.classList.add('disconnected');
      set_message('Disconnected from session');
      if (session.term) session.term.write('\r\n[Connection closed]\r\n');
      log_session_state('websocket_closed', { session_id: sid });
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      set_message('Connection error', true);
      session.is_connected = false;
      update_status('disconnected', false);
      log_session_state('websocket_error', { session_id: sid, error: err.message });
    };

  } catch (err) {
    set_message(`Error: ${err.message}`, true);
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

    log_session_state('page_initialized', { has_url_params: !!params.session_id });
  });
});
