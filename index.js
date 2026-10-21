import { isMainThread, Worker } from 'node:worker_threads';

let started = false;

/**
 * Reports the main thread's JavaScript stack when its event loop stops
 * turning for `thresholdMs`.
 *
 * Without `onBlock`, reports are written to stderr by the watcher thread as
 * soon as the stall is detected, so a loop that never recovers is still
 * reported. With `onBlock`, the callback gets `{ durationMs, stack }` on the
 * main thread once the loop runs again.
 */
export function watch({ thresholdMs = 1000, onBlock } = {}) {
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    throw new RangeError(`thresholdMs must be a positive number, got ${thresholdMs}`);
  }
  if (onBlock !== undefined && typeof onBlock !== 'function') {
    throw new TypeError('onBlock must be a function');
  }
  if (!isMainThread || started) return;
  started = true;

  // When the loop last turned, on a clock that is monotonic and shared by all
  // threads: a watcher thread that starts after the main thread has already
  // stalled dates the stall from it.
  const beat = new BigInt64Array(new SharedArrayBuffer(8));
  const turn = () => Atomics.store(beat, 0, process.hrtime.bigint());
  turn();
  // Under the permission model without --allow-inspector, connecting to the
  // main thread throws, and on Node.js 22 it aborts the whole process.
  const inspect = !process.permission || process.permission.has('inspector');
  let worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: { beat, thresholdMs, report: !onBlock, inspect },
      // Workers inherit execArgv and read NODE_OPTIONS from their env, which
      // would run the app's --require and --import hooks in this thread too.
      execArgv: [],
      env: {},
    });
  } catch (err) {
    // For example under --permission without --allow-worker.
    process.emitWarning(`why-is-node-blocked is disabled: ${err.message}`);
    return;
  }
  worker.on('error', (err) => process.emitWarning(`why-is-node-blocked stopped: ${err.message}`));
  if (onBlock) worker.on('message', onBlock);
  // After the listeners: adding the first 'message' listener refs the worker
  // again.
  worker.unref();

  setInterval(turn, Math.min(50, thresholdMs / 4)).unref();
}
