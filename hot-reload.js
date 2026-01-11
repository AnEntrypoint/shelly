// Hot reload monitor for development
// Watches files and invalidates client cache + restarts server on changes

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientFile = path.join(__dirname, 'src/client/public/client.js');
const serverFile = path.join(__dirname, 'src/server/index.js');
const watchDir = path.join(__dirname, 'src');

let lastMtime = 0;
let isRestarting = false;

export function setupHotReload() {
  try {
    const stats = fs.statSync(clientFile);
    lastMtime = stats.mtimeMs;

    // Monitor client.js for changes
    fs.watchFile(clientFile, (curr, prev) => {
      if (curr.mtimeMs !== lastMtime) {
        lastMtime = curr.mtimeMs;
        console.log('\n[HOT RELOAD] ✓ client.js changed - clients will reload on next request');
      }
    });

    // Monitor server files for changes
    fs.watchFile(serverFile, (curr, prev) => {
      if (!isRestarting && curr.mtimeMs > prev.mtimeMs) {
        console.log('\n[HOT RELOAD] ✓ server files changed - restarting server...');
        restartServer();
      }
    });

    console.log('[HOT RELOAD] Monitoring files for changes...');
  } catch (err) {
    console.log('[HOT RELOAD] Watch setup failed:', err.message);
  }
}

function restartServer() {
  isRestarting = true;
  console.log('[HOT RELOAD] Server restart in progress...');
  setTimeout(() => {
    try {
      process.exit(0);
    } catch (err) {
      console.error('[HOT RELOAD] Restart failed:', err.message);
      isRestarting = false;
    }
  }, 500);
}

// Middleware to invalidate client cache on changes
export function hotReloadMiddleware(req, res, next) {
  // Always disable cache for development
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('ETag', '"' + Date.now() + '"');
  next();
}
