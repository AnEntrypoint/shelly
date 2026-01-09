import readline from 'readline';
import { WebSocket } from 'ws';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(os.homedir(), '.shell_sessions');

function log_state(variable, prev_val, next_val, causation) {
  const timestamp = new Date().toISOString();
  console.error(JSON.stringify({
    timestamp,
    var: variable,
    prev: prev_val,
    next: next_val,
    causation,
    context: 'cli'
  }));
}

class PersistentSession {
  constructor(config) {
    this.id = config.session_id;
    this.token = config.token;
    this.shell_token = config.shell_token;
    this.server_url = config.server_url;
    this.ws = null;
    this.is_connected = false;
    this.rl = null;
    log_state('cli_session_created', null, this.id, 'init');
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        const protocol = this.server_url.startsWith('https') ? 'wss:' : 'ws:';
        const base_url = this.server_url.replace(/^https?:\/\//, '');
        const ws_url = `${protocol}//${base_url}/?session_id=${this.id}&token=${this.token}&type=provider`;

        this.ws = new WebSocket(ws_url);

        this.ws.on('open', () => {
          log_state('cli_ws_connected', false, true, 'ws_open');
          this.is_connected = true;

          const cols = process.stdout.columns || 120;
          const rows = process.stdout.rows || 30;
          this.resize(cols, rows);
          log_state('initial_resize_sent', null, `${cols}x${rows}`, 'terminal_size');

          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data);
            if (msg.type === 'relay_input' && msg.data) {
              const decoded = Buffer.from(msg.data, 'base64').toString();
              process.stdout.write(decoded);
            }
          } catch (err) {
            log_state('cli_message_parse_error', null, err.message, 'parse_failed');
          }
        });

        this.ws.on('close', () => {
          log_state('cli_ws_closed', true, false, 'ws_close');
          this.is_connected = false;
        });

        this.ws.on('error', (err) => {
          log_state('cli_ws_error', null, err.message, 'ws_error');
          reject(err);
        });

        setTimeout(() => {
          if (!this.is_connected) {
            reject(new Error('connection_timeout'));
          }
        }, 5000);
      } catch (err) {
        reject(err);
      }
    });
  }

  send_input(data) {
    if (!this.is_connected || !this.ws) return false;
    try {
      this.ws.send(JSON.stringify({
        type: 'input',
        data: Buffer.from(data).toString('base64')
      }));
      log_state('cli_input_sent', null, `${data.length}_bytes`, 'user_input');
      return true;
    } catch (err) {
      log_state('cli_input_error', null, err.message, 'send_failed');
      return false;
    }
  }

  resize(cols, rows) {
    if (!this.is_connected || !this.ws) return false;
    try {
      this.ws.send(JSON.stringify({
        type: 'resize',
        cols,
        rows
      }));
      return true;
    } catch (err) {
      log_state('cli_resize_error', null, err.message, 'resize_failed');
      return false;
    }
  }

  async save_config() {
    try {
      await fs.mkdir(SESSIONS_DIR, { recursive: true });
      const config_path = path.join(SESSIONS_DIR, `${this.id}.json`);
      await fs.writeFile(config_path, JSON.stringify({
        id: this.id,
        token: this.token,
        shell_token: this.shell_token,
        server_url: this.server_url,
        created_at: Date.now()
      }, null, 2));
      log_state('cli_config_saved', null, config_path, 'persist');
    } catch (err) {
      log_state('cli_config_save_error', null, err.message, 'save_failed');
    }
  }

  async load_config(session_id) {
    try {
      const config_path = path.join(SESSIONS_DIR, `${session_id}.json`);
      const data = await fs.readFile(config_path, 'utf-8');
      const config = JSON.parse(data);
      this.id = config.id;
      this.token = config.token;
      this.shell_token = config.shell_token;
      this.server_url = config.server_url;
      log_state('cli_config_loaded', null, session_id, 'restore');
      return true;
    } catch (err) {
      log_state('cli_config_load_error', null, err.message, 'load_failed');
      return false;
    }
  }

  start_input_loop() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    const handle_line = (line) => {
      if (line === '.exit') {
        log_state('cli_exit_requested', null, true, 'user_exit');
        this.rl.close();
        this.ws.close();
        process.exit(0);
      }
      this.send_input(line + '\n');
    };

    const handle_stdin = (chunk) => {
      this.send_input(chunk.toString());
    };

    const handle_resize = () => {
      if (process.stdout.isTTY) {
        const cols = process.stdout.columns || 120;
        const rows = process.stdout.rows || 30;
        this.resize(cols, rows);
        log_state('terminal_resized', null, `${cols}x${rows}`, 'sigwinch');
      }
    };

    if (process.stdin.isTTY) {
      this.rl.on('line', handle_line);
    } else {
      process.stdin.on('data', handle_stdin);
    }

    process.on('SIGWINCH', handle_resize);

    this.rl.on('close', () => {
      if (this.ws) {
        this.ws.close();
      }
      process.exit(0);
    });
  }

  close() {
    if (this.rl) {
      this.rl.close();
    }
    if (this.ws) {
      this.ws.close();
    }
    log_state('cli_session_closed', true, false, 'explicit_close');
  }
}

async function run_cli() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'new') {
    const server_url = args[1] || 'http://localhost:3000';
    const shell_token = args[2];

    if (!shell_token) {
      console.error('usage: node cli.js new <server_url> <shell_token>');
      process.exit(1);
    }

    try {
      const fetch_response = await fetch(`${server_url}/api/session`, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${shell_token}`,
          'content-type': 'application/json'
        }
      });

      if (!fetch_response.ok) {
        throw new Error(`http_${fetch_response.status}`);
      }

      const session_data = await fetch_response.json();
      const session = new PersistentSession({
        session_id: session_data.session_id,
        token: session_data.token,
        shell_token: session_data.shell_token,
        server_url
      });

      await session.save_config();
      await session.connect();
      session.resize(process.stdout.columns, process.stdout.rows);
      session.start_input_loop();

      console.log(`[session: ${session.id}]`);
      console.log(`[web: ${server_url}?session_id=${session.id}&token=${session.token}&shell_token=${shell_token}]`);

      process.on('SIGWINCH', () => {
        session.resize(process.stdout.columns, process.stdout.rows);
      });
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
  } else if (command === 'attach') {
    const session_id = args[1];
    if (!session_id) {
      console.error('usage: node cli.js attach <session-id>');
      process.exit(1);
    }

    try {
      const session = new PersistentSession({
        session_id: '',
        token: '',
        shell_token: '',
        server_url: ''
      });

      const loaded = await session.load_config(session_id);
      if (!loaded) {
        console.error('session not found');
        process.exit(1);
      }

      await session.connect();
      session.resize(process.stdout.columns, process.stdout.rows);
      session.start_input_loop();

      console.log(`[attached to: ${session.id}]`);

      process.on('SIGWINCH', () => {
        session.resize(process.stdout.columns, process.stdout.rows);
      });
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
  } else if (command === 'list') {
    try {
      const files = await fs.readdir(SESSIONS_DIR);
      const sessions_list = files.filter(f => f.endsWith('.json'));
      if (sessions_list.length === 0) {
        console.log('no sessions');
      } else {
        for (const file of sessions_list) {
          const sid = file.replace('.json', '');
          console.log(sid);
        }
      }
    } catch (err) {
      console.error(`error: ${err.message}`);
    }
  } else {
    console.error('usage:');
    console.error('  node cli.js new <server_url> <shell_token>');
    console.error('  node cli.js attach <session-id>');
    console.error('  node cli.js list');
  }
}

run_cli().catch(err => {
  log_state('cli_fatal_error', null, err.message, 'unhandled');
  process.exit(1);
});
