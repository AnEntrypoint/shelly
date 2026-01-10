import { WebSocket } from 'ws';
import fetch from 'node:fetch';

async function test() {
  // Step 1: Create a session
  const create_res = await fetch('http://localhost:3000/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test_provider_connect' })
  });
  
  const { session_id, token } = await create_res.json();
  console.log('✓ Session created:', session_id.substring(0, 8));
  
  // Step 2: Connect as provider via WebSocket
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:3000/?session_id=${session_id}&token=${token}&type=provider`);
    
    let connected = false;
    const timeout = setTimeout(() => {
      console.error('✗ WebSocket connection timeout');
      resolve(false);
    }, 2000);
    
    ws.on('open', () => {
      connected = true;
      console.log('✓ Provider WebSocket connected');
      clearTimeout(timeout);
      
      // Step 3: Query sessions
      setTimeout(async () => {
        const query_res = await fetch('http://localhost:3000/api/sessions/by-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'test_provider_connect' })
        });
        const { sessions } = await query_res.json();
        console.log(`✓ Sessions found: ${sessions.length}`);
        if (sessions.length > 0) {
          console.log('✓ Session ID matches:', sessions[0].id === session_id);
        }
        ws.close();
        resolve(sessions.length > 0);
      }, 500);
    });
    
    ws.on('error', (err) => {
      console.error('✗ WebSocket error:', err.message);
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

test().then(success => {
  process.exit(success ? 0 : 1);
});
