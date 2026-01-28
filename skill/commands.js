const server = require('../server');
const ipc = require('../ipc');
const health = require('../health');
const { userInfo } = require('os');

async function connect(ctx, args) {
  const info = await ipc.startDaemon(ctx.seed);
  ctx.connected = true;
  ctx.hypersshSeed = ctx.seed;
  ctx.user = userInfo().username;
  ctx.connectedAt = Date.now();
  ctx.daemonPid = info.pid;
  return { status: 'success', message: 'Connected', seed: ctx.seed, user: ctx.user };
}

async function send(ctx, args) {
  if (!ctx.connected) throw new Error('Not connected. Call connect first');
  const { text } = args;
  if (!text) throw new Error('text required');
  const daemonHealthy = await health.isDaemonHealthy(ctx.seed);
  if (!daemonHealthy) {
    ctx.connected = false;
    ctx.hypersshSeed = null;
    ctx.user = null;
    ctx.daemonPid = null;
    throw new Error('Daemon is not responding. Stale connection detected. Run "connect --seed ' + ctx.seed + '" to reconnect');
  }
  const result = await ipc.sendToDaemon(ctx.seed, { type: 'send', text });
  return { status: 'success', message: 'Sent and received', seed: ctx.seed, command: text, output: result.output || '' };
}

function receive(ctx) {
  if (!ctx.connected) throw new Error('Not connected. Call connect first');
  return { status: 'success', message: 'No buffered output (send returns output immediately)', seed: ctx.seed, data: '' };
}

async function status(ctx) {
  const result = { status: 'success', seed: ctx.seed, createdAt: new Date(ctx.createdAt).toISOString(), lastCmd: ctx.lastCmd };

  if (ctx.serverPid) {
    const serverAlive = health.isProcessAlive(ctx.serverPid);
    result.serving = serverAlive;
    result.serverPort = ctx.serverPort;
    result.serverPid = ctx.serverPid;
    result.user = ctx.user;
    if (!serverAlive) {
      result.warning = 'Server process is not running. Call "serve --seed ' + ctx.seed + '" to restart';
      ctx.serving = false;
      ctx.serverPort = null;
      ctx.serverPid = null;
    }
  } else if (ctx.connected) {
    const daemonHealthy = await health.isDaemonHealthy(ctx.seed);
    result.connected = daemonHealthy;
    result.hypersshSeed = ctx.hypersshSeed;
    result.user = ctx.user;
    result.connectedAt = ctx.connectedAt ? new Date(ctx.connectedAt).toISOString() : null;
    if (!daemonHealthy) {
      result.warning = 'Daemon is not responding. Stale connection detected. Run "connect --seed ' + ctx.seed + '" to reconnect';
      ctx.connected = false;
      ctx.hypersshSeed = null;
      ctx.user = null;
      ctx.daemonPid = null;
    }
  }
  return result;
}

async function disconnect(ctx) {
  if (ctx.connected) await ipc.stopDaemon(ctx.seed);
  ctx.connected = false;
  ctx.hypersshSeed = null;
  ctx.user = null;
  ctx.daemonPid = null;
  return { status: 'success', message: 'Disconnected', seed: ctx.seed };
}

function serve(ctx, args) {
  let { port } = args;
  if (ctx.serving && ctx.serverPid) {
    const serverAlive = health.isProcessAlive(ctx.serverPid);
    if (serverAlive) throw new Error('Already serving on this seed');
    ctx.serving = false;
    ctx.serverPort = null;
    ctx.serverPid = null;
  }
  if (!port) port = 9000 + Math.floor(Math.random() * 1000);
  const user = userInfo().username;
  const info = server.start(ctx.seed, port, user);
  ctx.serving = true;
  ctx.serverPort = port;
  ctx.serverPid = info.pid;
  ctx.user = user;
  server.restore(ctx.seed, info.pid, port, user);
  return { status: 'success', message: 'Server started', seed: ctx.seed, port, user, pid: info.pid, connectWith: `shelly connect --seed ${ctx.seed}` };
}

function stopServing(ctx) {
  if (!ctx.serving || !ctx.serverPid) throw new Error('No server running');
  const serverAlive = health.isProcessAlive(ctx.serverPid);
  if (!serverAlive) {
    ctx.serving = false;
    ctx.serverPort = null;
    ctx.serverPid = null;
    throw new Error('Server process is not running. Already stopped');
  }
  server.stop(ctx.serverPid);
  ctx.serving = false;
  ctx.serverPort = null;
  ctx.serverPid = null;
  return { status: 'success', message: 'Server stopped', seed: ctx.seed };
}

module.exports = { connect, send, receive, status, disconnect, serve, stopServing };
