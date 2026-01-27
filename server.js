const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const servers = new Map();

function start(seed, port, user) {
  const seedBytes = crypto.createHash('sha256').update(seed).digest();
  const seedHex = seedBytes.toString('hex');

  const proc = spawn('npx', ['hypertele-server', '-l', String(port), '--seed', seedHex, '--private'], {
    stdio: 'ignore',
    detached: true
  });

  proc.unref();
  servers.set(seed, { pid: proc.pid, port, user });
  return { pid: proc.pid, port, user };
}

function stop(pid) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (err) {
  }
}

function restore(seed, pid, port, user) {
  servers.set(seed, { pid, port, user });
}

module.exports = { start, stop, restore, servers };
