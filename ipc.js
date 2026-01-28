const net = require('net');
const path = require('path');
const fs = require('fs');

function getSocketPath(seed) {
  return path.join(process.env.HOME, '.shelly', `daemon-${seed}.sock`);
}

function sendToDaemon(seed, msg) {
  const socketPath = getSocketPath(seed);

  if (!fs.existsSync(socketPath)) {
    return Promise.reject(new Error(`Daemon not running. Run 'connect --seed ${seed}' first`));
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
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
    try {
      fs.unlinkSync(socketPath);
    } catch (err) {
    }
  }

  const daemon = spawn('node', [path.join(__dirname, 'daemon.js'), seed], {
    stdio: 'ignore',
    detached: true
  });

  daemon.unref();

  return new Promise((resolve, reject) => {
    let attempts = 0;
    const checkSocket = () => {
      if (fs.existsSync(socketPath)) {
        resolve({ pid: daemon.pid, seed });
      } else if (attempts++ < 50) {
        setTimeout(checkSocket, 100);
      } else {
        reject(new Error('Daemon failed to start'));
      }
    };
    checkSocket();
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
