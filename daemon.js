const net = require('net');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { userInfo } = require('os');

const seed = process.argv[2];
if (!seed) process.exit(1);

const socketPath = path.join(process.env.HOME, '.telessh', `daemon-${seed}.sock`);
const dir = path.dirname(socketPath);

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

if (fs.existsSync(socketPath)) {
  fs.unlinkSync(socketPath);
}

let user = userInfo().username;
let connected = true;

const server = net.createServer((socket) => {
  let input = '';

  socket.on('data', (chunk) => {
    input += chunk.toString();
    if (!input.includes('\n')) return;

    const line = input.trim();
    input = '';

    try {
      const msg = JSON.parse(line);
      handleCommand(msg, socket);
    } catch (err) {
      socket.write(JSON.stringify({ status: 'error', error: err.message }) + '\n');
      socket.end();
    }
  });

  socket.on('error', () => {});
  socket.on('end', () => {});
});

function handleCommand(msg, socket) {
  if (msg.type === 'send') {
    executeSend(msg.text)
      .then((output) => {
        socket.write(JSON.stringify({ status: 'success', output }) + '\n');
        socket.end();
      })
      .catch((err) => {
        socket.write(JSON.stringify({ status: 'error', error: err.message }) + '\n');
        socket.end();
      });
  } else if (msg.type === 'disconnect') {
    socket.write(JSON.stringify({ status: 'success' }) + '\n');
    socket.end();
    setTimeout(() => process.exit(0), 100);
  } else {
    socket.write(JSON.stringify({ status: 'error', error: 'Unknown command' }) + '\n');
    socket.end();
  }
}

function executeSend(text) {
  return new Promise((resolve) => {
    try {
      const output = execSync(
        `npx hyperssh -s ${seed} -u ${user} -e "${text.replace(/"/g, '\\"')}"`,
        { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      resolve(output);
    } catch (err) {
      resolve(`ERROR: ${err.message}\n`);
    }
  });
}

server.listen(socketPath, () => {});

process.on('SIGTERM', () => {
  server.close();
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }
  process.exit(0);
});

process.on('SIGHUP', () => {});
process.on('SIGINT', () => {
  server.close();
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }
  process.exit(0);
});
