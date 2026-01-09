import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { Packr } from 'msgpackr';
import net from 'net';
import { VncEncoder } from './vnc-encoder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const VNC_PROXY_PORT = process.env.VNC_PROXY_PORT || 5900;

const sessions = new Map();
const clients = new Map();
const password_groups = new Map();
const h264_streams = new Map();

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
  'vnc_tunnel_ready',
  'vnc_socket_error',
  'ws_auth_failed',
  'server_started',
  'h264_stream_started',
  'h264_stream_closed',
  'h264_send_error',
  'vnc_tunnel_failed',
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
        client.ws.send(JSON.stringify({
          type: 'output',
          data: data ? Buffer.from(data).toString('base64') : null,
          session_id: this.id,
          timestamp: Date.now()
        }));
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
const pack = new Packr();

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

class VncTunnel {
  constructor(session_id, token) {
    this.session_id = session_id;
    this.token = token;
    this.socket = null;
    this.ws = null;
    this.is_connected = false;
  }

  connect_to_vnc(vnc_host = 'localhost', vnc_port = 5900) {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: vnc_host, port: vnc_port }, () => {
        this.is_connected = true;
        log_state('vnc_socket_connected', null, `${vnc_host}:${vnc_port}`, 'vnc_tunnel_connect');
        resolve();
      });

      this.socket.on('error', (err) => {
        this.is_connected = false;
        log_state('vnc_socket_error', null, err.message, 'vnc_tunnel_error');
        reject(err);
      });

      this.socket.on('close', () => {
        this.is_connected = false;
        if (this.ws && this.ws.readyState === 1) {
          this.ws.close(1000, 'vnc_disconnected');
        }
        log_state('vnc_socket_closed', null, this.session_id, 'vnc_tunnel_close');
      });

      this.socket.on('data', (data) => {
        if (this.ws && this.ws.readyState === 1) {
          try {
            const packed = pack.pack({
              type: 'vnc_frame',
              session_id: this.session_id,
              data: data.toString('base64'),
              timestamp: Date.now()
            });
            this.ws.send(packed);
            log_state('vnc_frame_tunneled', null, `${data.length}_bytes`, 'vnc_tunnel_send');
          } catch (err) {
            log_state('vnc_pack_error', null, err.message, 'vnc_tunnel_pack');
          }
        }
      });

      setTimeout(reject, 5000);
    });
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.is_connected = false;
  }
}

const vnc_tunnels = new Map();

// Periodic cleanup of orphaned sessions (no provider and no clients for >30s)
setInterval(() => {
  const now = Date.now();
  const orphan_timeout = 30000; // 30 seconds

  for (const [session_id, session] of sessions) {
    if (!session.has_active_provider && session.clients_connected.size === 0) {
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

  log_state('ws_auth_attempt', null, { session_id, token_len: token?.length || 0, endpoint }, 'ws_connection_received');

  const session = sessions.get(session_id);
  if (!session) {
    log_state('ws_auth_failed', null, { session_id, reason: 'session_not_found', total_sessions: sessions.size }, 'invalid_ws_session');
    ws.close(4001, 'unauthorized');
    return;
  }

  if (token !== session.token) {
    log_state('ws_auth_failed', null, { session_id, token_match: false, provided_len: token?.length || 0, expected_len: session.token?.length || 0 }, 'invalid_ws_token_mismatch');
    ws.close(4001, 'unauthorized');
    return;
  }

  if (endpoint === '/api/vnc-video') {
    const encoder = new VncEncoder(session_id);
    h264_streams.set(client_id, encoder);

    try {
      const vnc_host = process.env.VNC_HOST || 'localhost';
      const vnc_port = parseInt(process.env.VNC_PORT || '5900');
      const video_width = parseInt(url.searchParams.get('width')) || 1024;
      const video_height = parseInt(url.searchParams.get('height')) || 768;
      const framerate = Math.max(2, Math.min(10, parseInt(url.searchParams.get('fps')) || 5));

      const stdout = encoder.init_display_encoder(vnc_host, vnc_port, video_width, video_height, framerate);

      ws.send(pack.pack({
        type: 'ready',
        session_id,
        stream_type: 'h264_video',
        width: video_width,
        height: video_height,
        fps: framerate,
        timestamp: Date.now()
      }));

      log_state('h264_stream_started', null, `${video_width}x${video_height}@${framerate}fps`, 'video_stream_init');

      encoder.on_frame((chunk) => {
        if (ws.readyState === 1) {
          try {
            const msg = pack.pack({
              type: 'h264_chunk',
              session_id,
              data: chunk.toString('base64'),
              timestamp: Date.now()
            });
            ws.send(msg);
          } catch (err) {
            log_state('h264_send_error', null, err.message, 'video_send_failed');
          }
        }
      });

      ws.on('message', (data) => {
        try {
          const msg = pack.unpack(data);
          if (msg.type === 'video_control' && msg.action === 'stop') {
            encoder.close();
            ws.close(1000, 'video_stopped');
          }
        } catch (err) {
          log_state('h264_message_error', null, err.message, 'video_msg_parse');
        }
      });

      ws.on('close', () => {
        encoder.close();
        h264_streams.delete(client_id);
        log_state('h264_stream_closed', null, client_id, 'video_stream_ws_closed');
      });

      ws.on('error', (err) => {
        log_state('h264_stream_ws_error', null, err.message, 'video_stream_ws_error');
      });
    } catch (err) {
      ws.close(4003, `h264_init_failed: ${err.message}`);
      log_state('h264_stream_init_failed', null, err.message, 'video_stream_init_error');
    }
  } else if (endpoint === '/api/vnc') {
    const tunnel = new VncTunnel(session_id, token);
    tunnel.ws = ws;
    vnc_tunnels.set(client_id, tunnel);

    tunnel.connect_to_vnc('localhost', 5900).then(() => {
      ws.send(pack.pack({
        type: 'ready',
        session_id,
        tunnel_type: 'vnc',
        timestamp: Date.now()
      }));
      log_state('vnc_tunnel_ready', null, client_id, 'vnc_ready');
    }).catch((err) => {
      ws.close(4003, `vnc_connection_failed: ${err.message}`);
      log_state('vnc_tunnel_failed', null, err.message, 'vnc_connect_error');
    });

    ws.on('message', (data) => {
      if (!tunnel.is_connected || !tunnel.socket) return;

      try {
        const msg = pack.unpack(data);
        if (msg.type === 'vnc_frame' && msg.data) {
          const buffer = Buffer.from(msg.data, 'base64');
          tunnel.socket.write(buffer);
          log_state('vnc_frame_received', null, `${buffer.length}_bytes`, 'vnc_tunnel_recv');
        }
      } catch (err) {
        log_state('vnc_unpack_error', null, err.message, 'vnc_tunnel_unpack');
      }
    });

    ws.on('close', () => {
      tunnel.close();
      vnc_tunnels.delete(client_id);
      log_state('vnc_tunnel_closed', null, client_id, 'vnc_tunnel_ws_closed');
    });

    ws.on('error', (err) => {
      log_state('vnc_tunnel_ws_error', null, err.message, 'vnc_tunnel_ws_error');
    });
  } else {
    const client_type = url.searchParams.get('type') || 'viewer';

    clients.set(client_id, { ws, session_id, client_type, connected_at: Date.now() });
    session.clients_connected.add(client_id);

    if (client_type === 'provider') {
      session.shell_provider_id = client_id;
      session.has_active_provider = true;
      log_state('shell_provider_connected', null, client_id, 'provider_connected');
      session.broadcast_log_event('shell_provider_connected', 'shell_provider_id', client_id);
    } else {
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
  console.log(`vnc tunnel: wss://localhost:${PORT}/api/vnc (optional, click VNC button in terminal)`);
  console.log(`h264 video: wss://localhost:${PORT}/api/vnc-video (optimized for slow internet)`);
  log_state('server_started', null, PORT, 'server_init');
});

export { ShellSession, sessions, clients, VncTunnel, vnc_tunnels, VncEncoder, h264_streams };
