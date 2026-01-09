# Secure Reverse Shell

A bidirectional web and CLI-based secure reverse shell system with proper terminal emulation via xterm.js. Both web and CLI clients can control the same shell session simultaneously.

## Features

- **Xterm.js Integration**: Full terminal emulation with proper echo, cursor handling, and ANSI color support
- **Bidirectional Communication**: Both web UI and CLI can type into the same shell session
- **Persistent Sessions**: Sessions persist across connections and can be reattached
- **Secure**: Bearer token authentication for all API endpoints
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
SHELL_TOKEN=your-secure-token npm run dev
```

Server runs on `http://localhost:3000`

### Web Client

Navigate to the URL printed by CLI, or manually:
```
http://localhost:3000?session_id=<id>&token=<token>&shell_token=<shell_token>
```

Then click "Connect" button.

### CLI Client

Create new session:
```bash
npm run cli -- new http://localhost:3000 <shell_token>
```

This outputs:
```
[session: <session-id>]
[web: http://localhost:3000?session_id=<id>&token=<token>&shell_token=<shell_token>]
```

Both URLs can be used simultaneously - type in CLI or web terminal, output appears in both.

Attach to existing session:
```bash
npm run cli -- attach <session-id>
```

List all sessions:
```bash
npm run cli -- list
```

## API Endpoints

### POST /api/session
Create a new shell session.

**Headers:**
```
Authorization: Bearer <shell_token>
Content-Type: application/json
```

**Response:**
```json
{
  "session_id": "uuid",
  "token": "session-token",
  "shell_token": "provided-shell-token"
}
```

### GET /api/session/:session_id
Get session status.

**Headers:**
```
Authorization: Bearer <shell_token>
```

**Response:**
```json
{
  "session_id": "uuid",
  "is_active": true,
  "clients": 2,
  "created_at": 1234567890
}
```

### GET /api/sessions
List all active sessions.

**Headers:**
```
Authorization: Bearer <shell_token>
```

**Response:**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "is_active": true,
      "clients": 1,
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
docker run -e SHELL_TOKEN=your-token -p 3000:3000 secure-reverse-shell
```

### Coolify (Nixpacks)

The project includes `nixpacks.toml` configured for Coolify:

1. Set environment variable `SHELL_TOKEN` to a strong random value
2. Deploy via Coolify UI or CLI
3. Configure reverse proxy (nginx/caddy) to forward requests
4. Access via `https://your-domain.com`

**Environment Variables:**
- `SHELL_TOKEN`: Bearer token for API authentication (required, set to strong value)
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

- Always set `SHELL_TOKEN` to a strong random value in production
- Use HTTPS/WSS in production via reverse proxy
- The shell runs as the node process user (typically non-root in containers)
- No authentication is required once a session is created and you have the session token
- Limit access to the server at the network level if running sensitive operations

## CLI Session Persistence

CLI stores session configs in `~/.shell_sessions/<session-id>.json`:

```json
{
  "id": "uuid",
  "token": "session-token",
  "shell_token": "provided-shell-token",
  "server_url": "http://localhost:3000",
  "created_at": 1234567890
}
```

This allows `npm run cli -- attach <session-id>` to reconnect without parameters.

## Limitations

- One shell per session (bash only currently)
- No session recording/playback
- No client-to-client communication
- Session dies if server restarts
