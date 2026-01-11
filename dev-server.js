#!/usr/bin/env node
// Development server launcher with auto-restart on exit

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(__dirname, 'src/server/index.js');

let isRestarting = false;
let serverProcess = null;

function startServer() {
  if (isRestarting) return;
  
  console.log('\n[Server] Starting server...');
  serverProcess = spawn('node', [serverScript], {
    stdio: 'inherit',
    cwd: __dirname
  });

  serverProcess.on('exit', (code) => {
    if (!isRestarting) {
      console.log(`\n[Server] Process exited with code ${code}`);
      console.log('[Server] Restarting in 1 second...');
      setTimeout(() => startServer(), 1000);
    }
  });

  serverProcess.on('error', (err) => {
    console.error('[Server] Error:', err.message);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  isRestarting = true;
  if (serverProcess) serverProcess.kill('SIGTERM');
  process.exit(0);
});

process.on('SIGINT', () => {
  isRestarting = true;
  if (serverProcess) serverProcess.kill('SIGINT');
  process.exit(0);
});

startServer();
