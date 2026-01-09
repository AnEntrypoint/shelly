# Secure Reverse Shell

A bidirectional web and CLI-based secure reverse shell system with multi-tab terminal emulation via xterm.js. Multiple CLI clients can connect with the same password and appear as separate tabs in the web interface.

## Features

- **Multi-Tab Web Interface**: All CLI sessions with the same password appear as tabs in one browser window
- **Real-Time Session Detection**: New sessions auto-detect within 2 seconds via polling
- **Xterm.js Integration**: Full terminal emulation with proper echo, cursor handling, and ANSI color support
- **Bidirectional Communication**: Web UI and CLI can simultaneously type into the same shell session
- **Password-Based Auth**: Groups sessions by password - all matching sessions visible together
- **Output Isolation**: Each terminal has its own output buffer (1 page worth = 3600 chars)
- **Persistent CLI**: CLI processes stay alive even when web viewers disconnect
- **Tab Auto-Cleanup**: Tabs automatically removed when CLI clients disconnect
- **Coolify/Nixpacks Ready**: Pre-configured for deployment on Coolify with reverse proxy support

## Architecture

```
┌─────────────────────────────────────────────┐
│         Node.js Server (Express)             │
│  ┌──────────────────────────────────────┐   │
│  │  WebSocket Server (ws)               │   │
│  │  - Handles web client connections    │   │
│  │  - Broadcasts shell output           │   │
│  │  - Routes input to PTY session       │   │
│  └──────────────────────────────────────┘   │
│  ┌──────────────────────────────────────┐   │
│  │  Express REST API                    │   │
│  │  - /api/session (POST) - create      │   │
│  │  - /api/session/:id (GET) - status   │   │
│  │  - /api/sessions (GET) - list all    │   │
│  └──────────────────────────────────────┘   │
│  ┌──────────────────────────────────────┐   │
│  │  PTY Sessions (node-pty)             │   │
│  │  - One bash shell per session        │   │
│  │  - Handles resize events             │   │
│  │  - Buffers output                    │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
        ↑                           ↑
        │ REST API                  │ WebSocket
        │ (Bearer Token)            │ (Session Token)
        ↓                           ↓
┌─────────────────┐        ┌──────────────────┐
│  CLI Client     │        │  Web Browser     │
│  (readline)     │        │  (xterm.js)      │
│  - persist      │        │  - visual term   │
│  - non-TTY      │        │  - mouse support │
│  - restore      │        │  - resize handle │
└─────────────────┘        └──────────────────┘
```

## Quick Start

### Server

```bash
npm install
npm run dev
```

Server runs on `http://localhost:3000` (no SHELL_TOKEN required - uses password-based auth)

### Web Client

1. Navigate to `http://localhost:3000`
2. Enter a password (any string - used to group sessions)
3. Click "Connect"
4. All CLI clients using the same password appear as tabs

### CLI Client (Recommended: NPX)

Create a new shell session (runs directly from GitHub):

```bash
npx -y gxe@latest AnEntrypoint/shellyclient start new http://localhost:3000 mypassword
```

Output:
```
[session: <session-id>]
[password-protected: yes]
[web: http://localhost:3000 (enter password to access)]
```

Then open the web UI, enter `mypassword`, and your CLI session appears as a tab.

**Multiple CLI clients with same password:**
```bash
# Terminal 1
npx -y gxe@latest AnEntrypoint/shellyclient start new http://localhost:3000 shared-pwd

# Terminal 2
npx -y gxe@latest AnEntrypoint/shellyclient start new http://localhost:3000 shared-pwd

# Terminal 3
npx -y gxe@latest AnEntrypoint/shellyclient start new http://localhost:3000 shared-pwd
```

Then open web UI, enter `shared-pwd`, and all 3 CLI sessions appear as separate, interactive tabs.

### CLI Client (Local Development)

If developing locally:

```bash
cd /path/to/shellyclient
node index.js new http://localhost:3000 mypassword
```

### Attach to Existing Session

If you saved a session config locally:
```bash
npx -y gxe@latest AnEntrypoint/shellyclient start attach <session-id>
```

List saved sessions:
```bash
npx -y gxe@latest AnEntrypoint/shellyclient start list
```

## API Endpoints

### POST /api/session
Create a new shell session (password-protected).

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "password": "your-password"
}
```

**Response:**
```json
{
  "session_id": "uuid",
  "token": "session-token"
}
```

### POST /api/sessions/by-password
List all active sessions for a given password.

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "password": "your-password"
}
```

**Response:**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "token": "session-token",
      "is_active": true,
      "clients": 2,
      "created_at": 1234567890,
      "uptime_ms": 5000
    }
  ]
}
```

### WebSocket Connection
URL: `ws://localhost:3000?session_id=<id>&token=<token>`

**Client → Server:**
```json
{"type": "input", "data": "base64-encoded-input"}
{"type": "resize", "cols": 120, "rows": 30}
```

**Server → Client:**
```json
{"type": "ready", "session_id": "uuid", "client_id": "uuid"}
{"type": "output", "data": "base64-encoded-output", "session_id": "uuid"}
```

## Deployment

### Docker

```bash
docker build -t secure-reverse-shell .
docker run -p 3000:3000 secure-reverse-shell
```

### Coolify (Nixpacks)

The project includes `nixpacks.toml` configured for Coolify:

1. Deploy via Coolify UI or CLI
2. Configure reverse proxy (nginx/caddy) to forward requests and upgrade WebSocket
3. Access via `https://your-domain.com`

**Environment Variables:**
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Set to `production` in Coolify

### Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name shell.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

## State Logging

All state changes are logged to stdout in JSON format for debugging:

```json
{
  "timestamp": "2026-01-09T05:38:58.233Z",
  "var": "pty_spawned",
  "prev": null,
  "next": "session-id",
  "causation": "shell_start",
  "stack": "at ShellSession.spawn_shell (src/server/index.js:66:9)"
}
```

## Security Notes

- **Password-Based Groups**: Sessions are grouped by password hash. Users who know the password can see all sessions with that password
- **Use HTTPS/WSS in production** via reverse proxy to encrypt passwords in transit
- **The shell runs as the node process user** (typically non-root in containers)
- **Session tokens grant full access**: Once a session token is obtained, it grants full shell access
- **No per-user isolation**: Multiple users with the same password can control the same shells
- **Limit network access** if running sensitive operations
- For production multi-tenant use, consider adding per-session access control or separate passwords per user/group

## CLI Session Persistence

CLI stores session configs in `~/.shell_sessions/<session-id>.json`:

```json
{
  "id": "uuid",
  "token": "session-token",
  "password": "your-password",
  "server_url": "http://localhost:3000",
  "created_at": 1234567890
}
```

This allows you to reconnect using:
```bash
npx -y gxe@latest AnEntrypoint/shellyclient start attach <session-id>
```

## Limitations

- **One shell per session** (bash only)
- **No session recording/playback**
- **No client-to-client communication** (only via shared shell)
- **Sessions lost on server restart** (no persistent storage)
- **No per-user isolation**: All users with same password see each other's sessions
- **Buffer limited to 1 page** (3,600 characters) to prevent memory bloat

## What's Included

✅ **Web Client**
- Multi-tab interface for viewing multiple sessions
- Real-time polling (2-second intervals) for new/removed sessions
- Full xterm.js terminal emulation
- Input/output isolation per tab
- Auto-cleanup when CLI clients disconnect

✅ **CLI Client (via npx)**
- Runs directly from GitHub: `npx -y gxe@latest AnEntrypoint/shellyclient start <command>`
- Stays alive even when web viewers disconnect
- Persistent session storage in ~/.shell_sessions/
- Window resize handling (SIGWINCH)
- Password-based session grouping

✅ **Server**
- Express.js with WebSocket support
- Password-based session grouping
- Real-time output broadcasting
- Input relay to shell provider
- State logging for debugging
- Automatic cleanup on disconnect
