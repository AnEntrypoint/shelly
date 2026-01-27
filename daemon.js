const net = require('net');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { userInfo } = require('os');

const seed = process.argv[2];
if (!seed) process.exit(1);

const socketPath = path.join(process.env.HOME, '.shelly', `daemon-${seed}.sock`);
const dir = path.dirname(socketPath);

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

if (fs.existsSync(socketPath)) {
  fs.unlinkSync(socketPath);
}

const user = userInfo().username;
let isAlive = true;

function exitGracefully() {
  isAlive = false;
  if (fs.existsSync(socketPath)) {
    try { fs.unlinkSync(socketPath); } catch (e) {}
  }
  process.exit(0);
}

function executeSend(text) {
  return new Promise((resolve) => {
    if (!isAlive) {
      return resolve({ output: 'ERROR: Daemon shutting down\n', connectionLost: false });
    }

    try {
      const output = execSync(
        `npx hyperssh -s ${seed} -u ${user} -e "${text.replace(/"/g, '\\"')}"`,
        { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      resolve({ output, connectionLost: false });
    } catch (err) {
      const errMsg = err.message || '';
      const connectionLost = /read: Connection reset|write: EPIPE|ETIMEDOUT/.test(errMsg);
      resolve({ output: `ERROR: ${errMsg}\n`, connectionLost });
    }
  });
}

const server = net.createServer((socket) => {
  let input = '';

  socket.on('data', (chunk) => {
    input += chunk.toString();
    if (!input.includes('\n')) return;

    const line = input.trim();
    input = '';

    const msg = JSON.parse(line);
    if (msg.type === 'send') {
      executeSend(msg.text)
        .then((result) => {
          socket.write(JSON.stringify({ status: 'success', output: result.output }) + '\n');
          socket.end();
          if (result.connectionLost) {
            setTimeout(exitGracefully, 100);
          }
        })
        .catch((err) => {
          socket.write(JSON.stringify({ status: 'error', error: err.message }) + '\n');
          socket.end();
        });
    } else if (msg.type === 'disconnect') {
      socket.write(JSON.stringify({ status: 'success' }) + '\n');
      socket.end();
      setTimeout(exitGracefully, 100);
    }
  });

  socket.on('error', () => {});
  socket.on('end', () => {});
});

server.listen(socketPath, () => {});

process.on('SIGTERM', exitGracefully);
process.on('SIGHUP', () => {});
process.on('SIGINT', exitGracefully);
