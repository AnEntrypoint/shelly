import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { v4 as uuid } from 'uuid';
import { spawn } from 'node-pty';
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
    this.pty = null;
    this.created_at = Date.now();
    this.clients_connected = new Set();
    this.buffer = [];
    this.is_active = true;
    log_state('session_created', null, session_id, 'new_session');
  }

  spawn_shell(shell_path = '/bin/bash') {
    try {
      this.pty = spawn(shell_path, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30
      });

      this.pty.on('data', (data) => {
        this.buffer.push(data);
        this.broadcast_to_clients(data);
      });

      this.pty.on('exit', (code) => {
        log_state('pty_exited', 'running', code, 'shell_closed');
        this.is_active = false;
        this.broadcast_to_clients(null);
        sessions.delete(this.id);
      });

      log_state('pty_spawned', null, this.id, 'shell_start');
      return true;
    } catch (err) {
      log_state('pty_spawn_error', null, err.message, 'spawn_failed');
      return false;
    }
  }

  send_input(data) {
    if (!this.is_active || !this.pty) return false;
    try {
      this.pty.write(data);
      log_state('input_sent', null, `${data.length}_bytes`, 'user_input');
      return true;
    } catch (err) {
      log_state('input_error', null, err.message, 'write_failed');
      return false;
    }
  }

  resize(cols, rows) {
    if (!this.pty) return false;
    try {
      this.pty.resize(cols, rows);
      log_state('pty_resized', null, `${cols}x${rows}`, 'resize_request');
      return true;
    } catch (err) {
      log_state('resize_error', null, err.message, 'resize_failed');
      return false;
    }
  }

  broadcast_to_clients(data) {
    for (const client_id of this.clients_connected) {
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

  close() {
    if (this.pty) {
      this.pty.kill();
      log_state('session_closed', 'active', 'terminated', 'explicit_close');
    }
    this.is_active = false;
    sessions.delete(this.id);
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

  if (!session.spawn_shell()) {
    return res.status(500).json({ error: 'failed_to_spawn_shell' });
  }

  sessions.set(session_id, session);
  log_state('session_created_http', null, session_id, 'http_create');

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

  const session = sessions.get(session_id);
  if (!session || token !== session.token) {
    log_state('ws_auth_failed', null, session_id, 'invalid_ws_token');
    ws.close(4001, 'unauthorized');
    return;
  }

  clients.set(client_id, { ws, session_id, connected_at: Date.now() });
  session.clients_connected.add(client_id);

  log_state('client_connected', null, client_id, 'ws_connected');

  ws.send(JSON.stringify({
    type: 'ready',
    session_id,
    client_id,
    timestamp: Date.now()
  }));

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.type === 'input') {
        const data = Buffer.from(msg.data, 'base64').toString();
        session.send_input(data);
      } else if (msg.type === 'resize') {
        session.resize(msg.cols, msg.rows);
      }
    } catch (err) {
      log_state('ws_message_error', null, err.message, 'parse_failed');
    }
  });

  ws.on('close', () => {
    session.clients_connected.delete(client_id);
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
