import { createHook } from 'node:async_hooks';
import { subscribe } from 'node:diagnostics_channel';
import { watch } from '../../index.js';

let workers = 0;
subscribe('worker_threads', () => workers++);

// The inner call's defaults (1000ms, stderr) would miss the 400ms stall below.
let inner;
let entered = false;
const reenter = () => {
  if (entered) return;
  entered = true;
  inner = watch();
};
if (process.argv[2] === 'channel') subscribe('worker_threads', reenter);
else createHook({ init: (_asyncId, type) => type === 'PROMISE' && reenter() }).enable();

const outer = watch({ thresholdMs: 200, onBlock: () => console.log('onBlock') });
await outer;
console.log(`${workers} worker, same promise: ${inner === outer}`);
const end = Date.now() + 400;
while (Date.now() < end);
setTimeout(() => {}, 500);
