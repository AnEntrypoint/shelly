import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SHELL_TOKEN = process.env.SHELL_TOKEN || crypto.randomBytes(32).toString('hex');

const sessions = new Map();
const clients = new Map();

function generate_token() {
  return crypto.randomBytes(16).toString('hex');
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
  constructor(session_id) {
    this.id = session_id;
    this.token = generate_token();
    this.created_at = Date.now();
    this.clients_connected = new Set();
    this.shell_provider_id = null;
    this.is_active = true;
    log_state('session_created', null, session_id, 'relay_session');
  }

  broadcast_to_clients(data, exclude_client_id = null) {
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
  const auth_header = req.headers.authorization || '';
  const provided_token = auth_header.replace('Bearer ', '');

  if (provided_token !== SHELL_TOKEN) {
    log_state('auth_failed', null, 'invalid_token', 'unauthorized_request');
    return res.status(401).json({ error: 'unauthorized' });
  }

  const session_id = uuid();
  const session = new ShellSession(session_id);
  sessions.set(session_id, session);
  log_state('session_created_http', null, session_id, 'relay_session_created');

  res.json({
    session_id,
    token: session.token,
    shell_token: SHELL_TOKEN
  });
});

app.get('/api/session/:session_id', (req, res) => {
  const auth_header = req.headers.authorization || '';
  const provided_token = auth_header.replace('Bearer ', '');

  if (provided_token !== SHELL_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const session = sessions.get(req.params.session_id);
  if (!session) {
    return res.status(404).json({ error: 'session_not_found' });
  }

  res.json({
    session_id: session.id,
    is_active: session.is_active,
    clients: session.clients_connected.size,
    created_at: session.created_at
  });
});

app.get('/api/sessions', (req, res) => {
  const auth_header = req.headers.authorization || '';
  const provided_token = auth_header.replace('Bearer ', '');

  if (provided_token !== SHELL_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const sessions_list = Array.from(sessions.values()).map(s => ({
    id: s.id,
    is_active: s.is_active,
    clients: s.clients_connected.size,
    created_at: s.created_at,
    uptime_ms: Date.now() - s.created_at
  }));

  log_state('sessions_list_requested', null, sessions_list.length, 'api_list');
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
  console.log(`auth token: ${SHELL_TOKEN}`);
});

export { ShellSession, sessions, clients };
