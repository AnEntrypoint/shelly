import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const sessions = new Map();
const clients = new Map();
const password_groups = new Map();

function generate_token() {
  return crypto.randomBytes(16).toString('hex');
}

function hash_password(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function log_state(variable, prev_val, next_val, causation) {
  const timestamp = new Date().toISOString();
  const stack = new Error().stack.split('\n')[2]?.trim() || 'unknown';
  console.log(JSON.stringify({
    timestamp,
    var: variable,
    prev: prev_val,
    next: next_val,
    causation,
    stack
  }));
}

class ShellSession {
  constructor(session_id, password = null) {
    this.id = session_id;
    this.token = generate_token();
    this.password_hash = password ? hash_password(password) : null;
    this.created_at = Date.now();
    this.clients_connected = new Set();
    this.shell_provider_id = null;
    this.is_active = true;
    this.viewport_buffer = [];
    this.viewport_cols = 120;
    this.viewport_rows = 30;
    this.max_buffer_size = 2400;
    log_state('session_created', null, session_id, 'relay_session');
  }

  update_viewport_size(cols, rows) {
    this.viewport_cols = cols || 120;
    this.viewport_rows = rows || 30;
    this.max_buffer_size = this.viewport_cols * this.viewport_rows;
  }

  buffer_output(data) {
    if (!data || data.length === 0) return;

    const str = typeof data === 'string' ? data : data.toString();
    this.viewport_buffer.push(str);

    const total_len = this.viewport_buffer.reduce((sum, s) => sum + s.length, 0);
    if (total_len > this.max_buffer_size) {
      let excess = total_len - this.max_buffer_size;
      while (excess > 0 && this.viewport_buffer.length > 0) {
        const first = this.viewport_buffer.shift();
        excess -= first.length;
      }
    }
  }

  get_current_buffer() {
    return this.viewport_buffer.join('');
  }

  broadcast_to_clients(data, exclude_client_id = null) {
    if (data && data.length > 0) {
      this.buffer_output(data);
    }

    for (const client_id of this.clients_connected) {
      if (client_id === exclude_client_id) continue;
      const client = clients.get(client_id);
      if (client && client.ws && client.ws.readyState === 1) {
        client.ws.send(JSON.stringify({
          type: 'output',
          data: data ? Buffer.from(data).toString('base64') : null,
          session_id: this.id,
          timestamp: Date.now()
        }));
      }
    }
  }

  relay_input_to_provider(data) {
    if (!this.shell_provider_id) return false;
    const provider = clients.get(this.shell_provider_id);
    if (provider && provider.ws && provider.ws.readyState === 1) {
      provider.ws.send(JSON.stringify({
        type: 'relay_input',
        data: data ? Buffer.from(data).toString('base64') : null,
        session_id: this.id,
        timestamp: Date.now()
      }));
      log_state('input_relayed', null, `${data.length}_bytes`, 'relay_to_provider');
      return true;
    }
    return false;
  }

  close() {
    this.is_active = false;
    this.viewport_buffer = [];
    if (this.password_hash) {
      const group = password_groups.get(this.password_hash) || [];
      const idx = group.indexOf(this.id);
      if (idx > -1) {
        group.splice(idx, 1);
      }
      if (group.length === 0) {
        password_groups.delete(this.password_hash);
      }
    }
    sessions.delete(this.id);
    log_state('session_closed', 'active', 'terminated', 'relay_close');
  }
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

const public_path = path.resolve(path.join(__dirname, '../client/public'));
app.use(express.static(public_path));

app.get('/', (req, res) => {
  res.sendFile(path.join(public_path, 'index.html'));
});

app.post('/api/session', (req, res) => {
  const password = req.body?.password;

  if (!password) {
    return res.status(400).json({ error: 'password_required' });
  }

  const session_id = uuid();
  const session = new ShellSession(session_id, password);
  sessions.set(session_id, session);

  const password_hash = hash_password(password);
  if (!password_groups.has(password_hash)) {
    password_groups.set(password_hash, []);
  }
  password_groups.get(password_hash).push(session_id);

  log_state('session_created_password', null, session_id, 'new_session');

  res.json({
    session_id,
    token: session.token
  });
});


app.post('/api/sessions/by-password', (req, res) => {
  const password = req.body?.password;

  if (!password) {
    return res.status(400).json({ error: 'password_required' });
  }

  const password_hash = hash_password(password);
  const session_ids = password_groups.get(password_hash) || [];

  const sessions_list = session_ids
    .map(id => sessions.get(id))
    .filter(s => s && s.is_active)
    .map(s => ({
      id: s.id,
      token: s.token,
      is_active: s.is_active,
      clients: s.clients_connected.size,
      created_at: s.created_at,
      uptime_ms: Date.now() - s.created_at
    }));

  log_state('password_sessions_requested', null, sessions_list.length, 'password_access');
  res.json({ sessions: sessions_list });
});

wss.on('connection', (ws, req) => {
  const client_id = uuid();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const session_id = url.searchParams.get('session_id');
  const token = url.searchParams.get('token');
  const client_type = url.searchParams.get('type') || 'viewer';

  const session = sessions.get(session_id);
  if (!session || token !== session.token) {
    log_state('ws_auth_failed', null, session_id, 'invalid_ws_token');
    ws.close(4001, 'unauthorized');
    return;
  }

  clients.set(client_id, { ws, session_id, client_type, connected_at: Date.now() });
  session.clients_connected.add(client_id);

  if (client_type === 'provider') {
    session.shell_provider_id = client_id;
    log_state('shell_provider_connected', null, client_id, 'provider_connected');
  } else {
    log_state('viewer_connected', null, client_id, 'viewer_connected');
  }

  ws.send(JSON.stringify({
    type: 'ready',
    session_id,
    client_id,
    client_type,
    timestamp: Date.now()
  }));

  const current_buffer = session.get_current_buffer();
  if (current_buffer && current_buffer.length > 0) {
    ws.send(JSON.stringify({
      type: 'buffer',
      data: Buffer.from(current_buffer).toString('base64'),
      session_id,
      timestamp: Date.now()
    }));
    log_state('buffer_sent', null, `${current_buffer.length}_bytes`, 'reconnect_buffer');
  }

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.type === 'output' && client_type === 'provider') {
        const data = Buffer.from(msg.data, 'base64');
        session.broadcast_to_clients(data, client_id);
        log_state('output_broadcasted', null, `${data.length}_bytes`, 'relay_output');
      } else if (msg.type === 'input' && client_type === 'viewer') {
        const data = Buffer.from(msg.data, 'base64');
        session.relay_input_to_provider(data);
      } else if (msg.type === 'resize' && client_type === 'provider') {
        session.update_viewport_size(msg.cols, msg.rows);
        log_state('viewport_updated', null, `${msg.cols}x${msg.rows}`, 'provider_resize');
      }
    } catch (err) {
      log_state('ws_message_error', null, err.message, 'parse_failed');
    }
  });

  ws.on('close', () => {
    session.clients_connected.delete(client_id);
    if (session.shell_provider_id === client_id) {
      session.shell_provider_id = null;
      log_state('shell_provider_disconnected', null, client_id, 'provider_closed');
      // Close the session when shell provider disconnects (no more input/output possible)
      session.close();
    }
    clients.delete(client_id);
    log_state('client_disconnected', null, client_id, 'ws_closed');
  });

  ws.on('error', (err) => {
    log_state('ws_error', null, err.message, 'ws_error');
  });
});

server.listen(PORT, () => {
  console.log(`shell server running on port ${PORT}`);
  console.log(`authentication: password-based (no shell token required)`);
});

export { ShellSession, sessions, clients };
