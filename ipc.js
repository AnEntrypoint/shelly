const net = require('net');
const path = require('path');
const fs = require('fs');

function getSocketPath(seed) {
  return path.join(process.env.HOME, '.shelly', `daemon-${seed}.sock`);
}

function sendToDaemon(seed, msg) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(getSocketPath(seed));
    let response = '';

    socket.on('connect', () => {
      socket.write(JSON.stringify(msg) + '\n');
    });

    socket.on('data', (chunk) => {
      response += chunk.toString();
      if (response.includes('\n')) {
        socket.end();
      }
    });

    socket.on('end', () => {
      try {
        resolve(JSON.parse(response.trim()));
      } catch (err) {
        reject(new Error(`Invalid response: ${response}`));
      }
    });

    socket.on('error', reject);

    setTimeout(() => {
      socket.destroy();
      reject(new Error('Daemon timeout'));
    }, 5000);
  });
}

function startDaemon(seed) {
  const { spawn } = require('child_process');
  const socketPath = getSocketPath(seed);
  const dir = path.dirname(socketPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }

  const daemon = spawn('node', [path.join(__dirname, 'daemon.js'), seed], {
    stdio: 'ignore',
    detached: true
  });

  daemon.unref();

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ pid: daemon.pid, seed });
    }, 100);
  });
}

function stopDaemon(seed) {
  const socketPath = getSocketPath(seed);
  return sendToDaemon(seed, { type: 'disconnect' })
    .then(() => {
      return new Promise((resolve) => {
        setTimeout(() => {
          if (fs.existsSync(socketPath)) {
            try { fs.unlinkSync(socketPath); } catch (err) {}
          }
          resolve();
        }, 300);
      });
    })
    .catch(() => {
      if (fs.existsSync(socketPath)) {
        try { fs.unlinkSync(socketPath); } catch (err) {}
      }
    });
}

module.exports = { sendToDaemon, startDaemon, stopDaemon, getSocketPath };
