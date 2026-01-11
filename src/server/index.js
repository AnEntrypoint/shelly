import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { Packr } from 'msgpackr';
import { setupHotReload, hotReloadMiddleware } from '../../hot-reload.js';

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

const USER_FACING_EVENTS = new Set([
  'session_created',
  'session_closed',
  'client_disconnected',
  'shell_provider_connected',
  'shell_provider_disconnected',
  'viewer_connected',
  'ws_auth_failed',
  'server_started',
  'session_created_password'
]);

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

function log_to_client(variable, prev_val, next_val, causation) {
  if (USER_FACING_EVENTS.has(causation)) {
    return {
      type: 'log_event',
      event: causation,
      var: variable,
      next: next_val,
      timestamp: Date.now()
    };
  }
  return null;
}

class ShellSession {
  constructor(session_id, password = null) {
    this.id = session_id;
    this.token = generate_token();
    this.password_hash = password ? hash_password(password) : null;
    this.created_at = Date.now();
    this.clients_connected = new Set();
    this.shell_provider_id = null;
    this.has_active_provider = false;
    this.is_active = true;
    this.has_had_viewer_connection = false;
    this.viewport_buffer = [];
    this.viewport_cols = 120;
    this.viewport_rows = 30;
    // Buffer limited to exactly 1 page worth (1 screen = 120 cols × 30 rows)
    this.max_buffer_size = 3600;
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
        try {
          const msg = pack.pack({
            type: 'output',
            data: data ? Buffer.from(data).toString('base64') : null,
            session_id: this.id,
            timestamp: Date.now()
          });
          client.ws.send(msg);
        } catch (err) {
          log_state('broadcast_pack_error', null, err.message, 'pack_failed');
        }
      }
    }
  }

  broadcast_log_event(event, var_name, var_value) {
    const log_msg = log_to_client(var_name, null, var_value, event);
    if (!log_msg) return;

    for (const client_id of this.clients_connected) {
      const client = clients.get(client_id);
      if (client && client.ws && client.ws.readyState === 1) {
        try {
          client.ws.send(JSON.stringify(log_msg));
        } catch (err) {
          // Silently ignore broadcast errors
        }
      }
    }
  }

  relay_input_to_provider(data) {
    if (!this.shell_provider_id) return false;
    const provider = clients.get(this.shell_provider_id);
    if (provider && provider.ws && provider.ws.readyState === 1) {
      try {
        const msg = pack.pack({
          type: 'relay_input',
          data: data ? Buffer.from(data).toString('base64') : null,
          session_id: this.id,
          timestamp: Date.now()
        });
        provider.ws.send(msg);
      } catch (err) {
        log_state('input_relay_pack_error', null, err.message, 'pack_failed');
        return false;
      }
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
const pack = new Packr();

app.use(express.json());
app.use(hotReloadMiddleware);  // Disable caching for hot reload

// Log WebSocket upgrade attempts
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const session_id = url.searchParams.get('session_id');
  const client_type = url.searchParams.get('type') || 'unknown';
  log_state('ws_upgrade_attempt', null, { session_id: session_id?.substring(0, 8), client_type, headers: { upgrade: req.headers.upgrade, connection: req.headers.connection } }, 'ws_upgrade_started');
});

// Log WebSocket connection errors
wss.on('error', (err) => {
  log_state('wss_error', null, err.message, 'wss_internal_error');
});

const public_path = path.resolve(path.join(__dirname, '../client/public'));
app.use(express.static(public_path));

app.get('/', (req, res) => {
  res.sendFile(path.join(public_path, 'index.html'));
});


app.post('/api/session', (req, res) => {
  const password = req.body?.password;

  log_state('api_session_called', null, {
    has_password: !!password,
    password_len: password?.length || 0,
    total_sessions_before: sessions.size
  }, 'api_session_request');

  if (!password) {
    return res.status(400).json({ error: 'password_required' });
  }

  const session_id = uuid();
  const session = new ShellSession(session_id, password);
  sessions.set(session_id, session);

  log_state('api_session_stored', null, {
    session_id: session_id.substring(0, 8),
    token_len: session.token.length,
    total_sessions_after: sessions.size
  }, 'api_session_stored');

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

  log_state('debug_password_lookup', null, {
    password_hash: password_hash.substring(0, 8),
    session_ids_in_group: session_ids.length,
    total_sessions: sessions.size,
    group_exists: password_groups.has(password_hash)
  }, 'debug_password_access');

  const sessions_list = session_ids
    .map(id => {
      const s = sessions.get(id);
      if (s) {
        log_state('debug_session_check', null, {
          session_id: id.substring(0, 8),
          is_active: s.is_active,
          has_active_provider: s.has_active_provider,
          provider_id: s.shell_provider_id?.substring(0, 8) || null,
          provider_connected: s.shell_provider_id ? (clients.get(s.shell_provider_id)?.ws?.readyState === 1) : false
        }, 'debug_session_filter');
      }
      return s;
    })
    .filter(s => {
      if (!s || !s.is_active || !s.has_active_provider) {
        return false;
      }
      // Verify provider is actually connected (not stale)
      if (s.shell_provider_id) {
        const provider = clients.get(s.shell_provider_id);
        if (!provider || !provider.ws || provider.ws.readyState !== 1) {
          // Provider is stale, mark as disconnected and filter out
          s.has_active_provider = false;
          return false;
        }
      }
      return true;
    })
    .map(s => ({
      id: s.id,
      token: s.token,
      is_active: s.is_active,
      has_active_provider: s.has_active_provider,
      clients: s.clients_connected.size,
      created_at: s.created_at,
      uptime_ms: Date.now() - s.created_at
    }));

  log_state('password_sessions_requested', null, sessions_list.length, 'password_access');
  res.json({ sessions: sessions_list });
});

// Periodic cleanup of orphaned sessions (no provider and no clients for >30s, AND never had a viewer)
setInterval(() => {
  const now = Date.now();
  const orphan_timeout = 30000; // 30 seconds

  for (const [session_id, session] of sessions) {
    if (!session.has_active_provider && session.clients_connected.size === 0 && !session.has_had_viewer_connection) {
      const age = now - session.created_at;
      if (age > orphan_timeout) {
        session.close();
        log_state('orphaned_session_cleaned', null, session_id, 'cleanup_timeout');
      }
    }
  }
}, 10000); // Check every 10 seconds

wss.on('connection', (ws, req) => {
  const client_id = uuid();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const session_id = url.searchParams.get('session_id');
  const token = url.searchParams.get('token');
  const endpoint = url.pathname;
  const client_type = url.searchParams.get('type') || 'unknown';

  log_state('ws_connection_accepted', null, {
    session_id: session_id?.substring(0, 8),
    token_len: token?.length || 0,
    endpoint,
    client_type,
    client_id: client_id.substring(0, 8),
    readyState: ws.readyState,
    total_sessions: sessions.size,
    all_session_ids: Array.from(sessions.keys()).map(id => id.substring(0, 8))
  }, 'ws_handshake_complete');

  const session = sessions.get(session_id);
  if (!session) {
    log_state('ws_auth_failed', null, {
      session_id: session_id?.substring(0, 8),
      reason: 'session_not_found',
      total_sessions: sessions.size,
      all_sessions: Array.from(sessions.keys()).map(id => id.substring(0, 8))
    }, 'invalid_ws_session');
    ws.close(4001, 'unauthorized');
    return;
  }

  if (token !== session.token) {
    log_state('ws_auth_failed', null, {
      session_id: session_id?.substring(0, 8),
      token_match: false,
      provided: token,
      expected: session.token,
      provided_len: token?.length || 0,
      expected_len: session.token?.length || 0,
      endpoint
    }, 'invalid_ws_token_mismatch');
    ws.close(4001, 'unauthorized');
    return;
  }

  if (true) {
    const client_type = url.searchParams.get('type') || 'viewer';

    clients.set(client_id, { ws, session_id, client_type, connected_at: Date.now() });
    session.clients_connected.add(client_id);

    if (client_type === 'provider') {
      session.shell_provider_id = client_id;
      session.has_active_provider = true;
      log_state('shell_provider_connected', null, client_id, 'provider_connected');
      session.broadcast_log_event('shell_provider_connected', 'shell_provider_id', client_id);
    } else {
      session.has_had_viewer_connection = true;
      log_state('viewer_connected', null, client_id, 'viewer_connected');
      session.broadcast_log_event('viewer_connected', 'client_id', client_id);
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
        let msg;
        try {
          msg = pack.unpack(message);
        } catch {
          msg = JSON.parse(message);
        }

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
        session.has_active_provider = false;
        log_state('shell_provider_disconnected', null, client_id, 'provider_closed');
        session.broadcast_log_event('shell_provider_disconnected', 'shell_provider_id', null);
      } else {
        log_state('client_disconnected', null, client_id, 'ws_closed');
        session.broadcast_log_event('client_disconnected', 'client_id', client_id);
      }
      clients.delete(client_id);
    });

    ws.on('error', (err) => {
      log_state('ws_error', null, err.message, 'ws_error');
    });
  }
});

server.listen(PORT, () => {
  console.log(`shell server running on port ${PORT}`);
  console.log(`authentication: password-based (no shell token required)`);
  log_state('server_started', null, PORT, 'server_init');

  // Setup hot reload monitoring for development
  setupHotReload();
});

export { ShellSession, sessions, clients };
