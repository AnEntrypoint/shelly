const net = require('net');
const fs = require('fs');
const path = require('path');

function getSocketPath(seed) {
  return path.join(process.env.HOME, '.shelly', `daemon-${seed}.sock`);
}

async function isDaemonHealthy(seed) {
  const socketPath = getSocketPath(seed);

  if (!fs.existsSync(socketPath)) {
    return false;
  }

  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let connected = false;

    socket.on('connect', () => {
      connected = true;
      socket.end();
    });

    socket.on('end', () => {
      resolve(connected);
    });

    socket.on('error', () => {
      resolve(false);
    });

    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1000);
  });
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { isDaemonHealthy, isProcessAlive, getSocketPath };
