const telessh = require('./index');

async function example() {
  console.log('=== Telessh Programmatic API Examples ===\n');

  console.log('1. Create a session (without connecting)');
  const state = telessh.getState();
  const sess = state.createSession('demo1', 'abcd1234', 'alice');
  console.log('Created:', sess.id);

  console.log('\n2. List sessions');
  const sessions = telessh.listSessions();
  console.log(sessions);

  console.log('\n3. Log entries');
  state.log('Starting demo session', 'info');
  state.log('This is a warning', 'warn');
  const logs = telessh.getLogs();
  console.log(`Total logs: ${logs.length}`);

  console.log('\n4. Filter logs by level');
  const errors = telessh.getLogs({ level: 'error' });
  console.log(`Error logs: ${errors.length}`);

  console.log('\n5. Get specific session');
  const session = telessh.getSession('demo1');
  console.log('Found:', session.id, session.seed, session.user);

  console.log('\n6. Simulate buffer operations');
  session.buffer.push('output line 1\n');
  session.buffer.push('output line 2\n');
  const buffer = telessh.getBuffer('demo1');
  console.log('Buffer:', buffer);

  console.log('\n7. Clear buffer');
  const cleared = telessh.clearBuffer('demo1');
  console.log('Cleared:', cleared);

  console.log('\n8. Demonstrate log clearing');
  const beforeClear = telessh.getLogs().length;
  telessh.clearLogs();
  const afterClear = telessh.getLogs().length;
  console.log(`Before: ${beforeClear}, After: ${afterClear}`);

  console.log('\n9. Global debug hook access');
  console.log('Available at: global.telesshDebug');
  console.log('Methods: state(), logs(), sessions(), getLogs(filter), getSession(id), help()');

  console.log('\n=== Demo Complete ===');
}

example().catch(console.error);
