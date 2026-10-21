import { parentPort, workerData } from 'node:worker_threads';
import { writeSync } from 'node:fs';

const { beat, thresholdMs, report, inspect } = workerData;
const tickMs = Math.min(50, thresholdMs / 4);

// Worker stdio is relayed through the main thread, which is the one stuck.
const write = (text) => writeSync(2, text);

let session;
let unavailable = 'stack unavailable: the permission model denies the inspector';
if (inspect) {
  try {
    const { Session } = await import('node:inspector');
    const connecting = new Session();
    connecting.connectToMainThread();
    session = connecting;
  } catch (err) {
    unavailable = `stack unavailable: ${err.message}`;
  }
}

// Debugger.CallFrame.url is deprecated and arrives empty. Debugger.enable
// replays scriptParsed for every loaded script before any pause is reported.
const urls = new Map();
// The capture in flight: the beat it was started at, whether our
// Debugger.enable has been answered, and how to settle it.
let capture = null;

session?.on('Debugger.scriptParsed', ({ params }) => urls.set(params.scriptId, params.url));

session?.on('Debugger.paused', ({ params }) => {
  // Enabling the debugger while another client (DevTools) holds the thread
  // paused reports that pause before answering the enable. That pause is not
  // ours to resume.
  if (capture && !capture.enabled) {
    session.post('Debugger.disable');
    settle('the main thread is paused in a debugger');
    return;
  }
  session.post('Debugger.resume');
  session.post('Debugger.disable');
  if (!capture) return;
  // A pause that lands after the loop turned again shows unrelated code.
  if (Atomics.load(beat, 0) !== capture.beat) {
    settle('the loop resumed before the main thread could be paused');
    return;
  }
  settle(params.callFrames.map(({ functionName, location }) => ({
    functionName: functionName || '<anonymous>',
    url: urls.get(location.scriptId) ?? '',
    line: location.lineNumber + 1,
    column: location.columnNumber + 1,
  })));
});

function settle(result) {
  capture?.resolve(result);
  capture = null;
  // The next Debugger.enable replays the scripts that are still alive.
  urls.clear();
}

// Resolves to the main thread's frames, or to a string saying why there are
// none. The CPU profiler would avoid Debugger.enable's cost, but when started
// mid-stall its samples lose the frame of a function running in OSR code,
// which is what a hot loop is.
function captureStack(beatValue) {
  if (!session) return Promise.resolve(unavailable);
  return new Promise((resolve) => {
    capture = { beat: beatValue, enabled: false, resolve };
    // The main thread runs these from a V8 interrupt at its next JavaScript
    // stack check. Sent together, they land in the same interrupt, so a thread
    // coming back from a syscall pauses before it unwinds.
    session.post('Debugger.enable', () => {
      if (capture) capture.enabled = true;
    });
    session.post('Debugger.pause');
  });
}

function describe(result) {
  if (typeof result === 'string') return `    (${result})\n`;
  return result.map(({ functionName, url, line, column }) => `    at ${functionName} (${url}:${line}:${column})\n`).join('');
}

const elapsedMs = (from, to) => Number(to - from) / 1e6;

let last = Atomics.load(beat, 0);
let pending = null;

setInterval(() => {
  const current = Atomics.load(beat, 0);
  if (current !== last) {
    if (pending) {
      const durationMs = Math.round(elapsedMs(last, current));
      pending.then((result) => {
        if (report) write(`why-is-node-blocked: event loop resumed after ${durationMs}ms\n`);
        else if (typeof result === 'string') parentPort.postMessage({ durationMs, stack: null, reason: result });
        else parentPort.postMessage({ durationMs, stack: result });
      });
      pending = null;
    }
    last = current;
  } else if (!pending && elapsedMs(last, process.hrtime.bigint()) >= thresholdMs) {
    // Printed now rather than with the stack: a thread stuck in native code
    // runs no JavaScript, so the pause may never come.
    if (report) write(`why-is-node-blocked: event loop blocked for over ${thresholdMs}ms\n`);
    // ponytail: one capture per stall and no rate limit. The first capture
    // hashes the source of every loaded script (~6ms/MB) and each one replays
    // scriptParsed (~6us/script); add a minimum interval between captures if
    // apps with frequent stalls show that cost.
    pending = captureStack(current);
    if (report) pending.then((result) => write(describe(result)));
  }
}, tickMs);

parentPort.postMessage('ready');
