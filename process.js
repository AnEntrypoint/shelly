const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { userInfo } = require('os');

function getConnPaths(seed) {
  const dir = path.join(process.env.HOME, '.shelly', 'conns');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return {
    info: path.join(dir, `${seed}.json`),
    history: path.join(dir, `${seed}.history`)
  };
}

function connect(seed) {
  const user = userInfo().username;
  const { info, history } = getConnPaths(seed);

  if (fs.existsSync(info)) {
    throw new Error(`Already connected on seed ${seed}`);
  }

  const data = { seed, user, connectedAt: Date.now() };
  fs.writeFileSync(info, JSON.stringify(data));
  fs.writeFileSync(history, '');

  return { user, seed };
}

function send(seed, text) {
  const { info, history } = getConnPaths(seed);

  if (!fs.existsSync(info)) {
    throw new Error(`Not connected on seed ${seed}`);
  }

  const conn = JSON.parse(fs.readFileSync(info, 'utf-8'));

  try {
    const output = execSync(
      `npx hyperssh -s ${seed} -u ${conn.user} -e "${text.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    fs.appendFileSync(history, output);
  } catch (err) {
    fs.appendFileSync(history, `ERROR: ${err.message}\n`);
  }
}

function receive(seed) {
  const { history } = getConnPaths(seed);

  if (!fs.existsSync(history)) {
    return '';
  }

  const data = fs.readFileSync(history, 'utf-8');
  fs.writeFileSync(history, '');
  return data;
}

function disconnect(seed) {
  const { info, history } = getConnPaths(seed);

  try {
    if (fs.existsSync(info)) fs.unlinkSync(info);
    if (fs.existsSync(history)) fs.unlinkSync(history);
  } catch (err) {
  }
}

function isConnected(seed) {
  const { info } = getConnPaths(seed);
  return fs.existsSync(info);
}

module.exports = { connect, send, receive, disconnect, isConnected };
