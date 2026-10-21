import { Worker } from 'node:worker_threads';

// Another inspector client, standing in for DevTools, holds the main thread
// at a `debugger` statement for 800ms.
const client = new Worker(`
  const { parentPort } = require('node:worker_threads');
  const { Session } = require('node:inspector');
  const session = new Session();
  session.connectToMainThread();
  session.on('Debugger.paused', () => setTimeout(() => session.post('Debugger.resume'), 800));
  session.post('Debugger.enable', () => parentPort.postMessage('ready'));
  setInterval(() => {}, 1000);
`, { eval: true });

client.on('message', () => {
  const start = performance.now();
  debugger;
  console.log(Math.round(performance.now() - start));
  setTimeout(() => client.terminate(), 300);
});
