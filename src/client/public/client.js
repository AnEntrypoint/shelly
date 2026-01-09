let term;
let fitAddon;
let ws;
let is_connected = false;
let current_session = null;

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
  init_terminal();

  const params = parse_url_params();
  if (params.session_id && params.token) {
    connectToSession();
  }
});
