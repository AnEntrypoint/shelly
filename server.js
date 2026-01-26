const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const servers = new Map();

function start(seed, port, user) {
  const sock = path.join(os.tmpdir(), `hypertele-${seed}.sock`);

  const proc = spawn('npx', ['hypertele', '-p', String(port), '-u', sock, '--private'], {
    stdio: 'ignore',
    detached: true
  });

  proc.unref();
  servers.set(seed, { pid: proc.pid, port, user, sock });
  return { pid: proc.pid, port, user };
}

function stop(pid) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (err) {
  }
}

function restore(seed, pid, port, user) {
  servers.set(seed, { pid, port, user, sock: path.join(os.tmpdir(), `hypertele-${seed}.sock`) });
}

module.exports = { start, stop, restore, servers };
