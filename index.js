import { isMainThread, Worker } from 'node:worker_threads';

// Created at load time rather than in watch(): creating a promise runs
// async_hooks init hooks, and one that called watch() before the first call
// had marked itself started would start the watcher with its own options.
const startup = Promise.withResolvers();
let started = false;

/**
 * Reports the main thread's JavaScript stack when its event loop stops
 * turning for `thresholdMs`.
 *
 * Without `onBlock`, reports are written to stderr by the watcher thread as
 * soon as the stall is detected, so a loop that never recovers is still
 * reported. With `onBlock`, the callback gets `{ durationMs, stack }` on the
 * main thread once the loop runs again.
 *
 * Returns a promise that resolves once the watcher thread is running, when it
 * fails or exits before that, or when a 2-second timer fires. The wait is best
 * effort and never rejects; errors are emitted as process warnings. Stalls
 * that end before the watcher runs go unseen. Later calls return the first
 * call's promise and ignore their options.
 */
export function watch({ thresholdMs = 1000, onBlock } = {}) {
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    throw new RangeError(`thresholdMs must be a positive number, got ${thresholdMs}`);
  }
  if (onBlock !== undefined && typeof onBlock !== 'function') {
    throw new TypeError('onBlock must be a function');
  }
  if (!isMainThread) return Promise.resolve();
  // Marked before start(), which can reach watch() again synchronously through
  // a worker_threads diagnostics channel subscriber.
  if (!started) {
    started = true;
    try {
      start(thresholdMs, onBlock, startup.resolve);
    } catch (err) {
      // For example under --permission without --allow-worker, or with
      // SharedArrayBuffer disabled.
      process.emitWarning(`why-is-node-blocked is disabled: ${err.message}`);
      startup.resolve();
    }
  }
  return startup.promise;
}

function start(thresholdMs, onBlock, resolve) {
  // When the loop last turned, on a clock that is monotonic and shared by all
  // threads: a watcher thread that starts after the main thread has already
  // stalled dates the stall from it.
  const beat = new BigInt64Array(new SharedArrayBuffer(8));
  const turn = () => Atomics.store(beat, 0, process.hrtime.bigint());
  turn();
  // Under the permission model without --allow-inspector, connecting to the
  // main thread throws, and on Node.js 22 it aborts the whole process.
  const inspect = !process.permission || process.permission.has('inspector');
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    workerData: { beat, thresholdMs, report: !onBlock, inspect },
    // Workers inherit execArgv and read NODE_OPTIONS from their env, which
    // would run the app's --require and --import hooks in this thread too.
    execArgv: [],
    env: {},
  });
  setInterval(turn, Math.min(50, thresholdMs / 4)).unref();

  // The worker stays referenced until it is watching, so an --import that
  // awaits this keeps the loop alive. Unreferencing it last matters: adding
  // the first 'message' listener references the worker again.
  const ready = () => {
    clearTimeout(timer);
    worker.unref();
    resolve();
  };
  const timer = setTimeout(ready, 2000);
  worker.on('message', (message) => (message === 'ready' ? ready() : onBlock?.(message)));
  worker.on('error', (err) => {
    process.emitWarning(`why-is-node-blocked stopped: ${err.message}`);
    ready();
  });
  worker.on('exit', ready);
}
