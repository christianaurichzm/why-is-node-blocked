# why-is-node-blocked

Find the line of JavaScript that is blocking your Node.js event loop.

```console
$ npx why-is-node-blocked example.mjs
why-is-node-blocked: event loop blocked for over 1000ms
    at resizeImage (example.mjs:7:3)
    at <anonymous> (example.mjs:19:1)
why-is-node-blocked: event loop resumed after 2006ms
why-is-node-blocked: event loop blocked for over 1000ms
    at isValidEmail (example.mjs:11:21)
    at <anonymous> (example.mjs:21:1)
why-is-node-blocked: event loop resumed after 4140ms
why-is-node-blocked: event loop blocked for over 1000ms
    at getStderr (node:internal/bootstrap/switches/is_main_thread:174:3)
    at execSync (node:child_process:986:13)
    at gitRevision (example.mjs:15:10)
    at <anonymous> (example.mjs:23:1)
why-is-node-blocked: event loop resumed after 2119ms
```

Busy loops, catastrophic regular expressions, synchronous `fs` and
`child_process` calls: when the main thread stops turning the event loop, you
get the stack it is stuck in. No code changes, no
dependencies, nothing running on the main thread while the loop is healthy.

## Usage

Run a script with it:

```sh
npx why-is-node-blocked server.js
```

Or install it and load it before your app:

```sh
npm install why-is-node-blocked
node --import why-is-node-blocked/register server.js
NODE_OPTIONS="--import why-is-node-blocked/register" npm start
```

The threshold defaults to 1000ms; set `WHY_IS_NODE_BLOCKED_MS` to change it.

To send reports to your logger instead of stderr:

```js
import { watch } from 'why-is-node-blocked';

watch({
  thresholdMs: 500,
  onBlock({ durationMs, stack, reason }) {
    logger.warn({ durationMs, stack, reason }, 'event loop blocked');
  },
});
```

`onBlock` runs on the main thread once the loop turns again. `stack` is an
array of `{ functionName, url, line, column }`, or `null` with a `reason` when
no stack could be taken. The stderr reporter writes from another thread as
soon as the stall is detected, so it also reports a loop that never recovers.

Requires Node.js 22.15 or later.

## How it works

The main thread bumps a counter in a `SharedArrayBuffer` every 50ms. A worker
thread watches the counter. When it stops moving for longer than the
threshold, the worker opens an inspector session to the main thread
(`Session.connectToMainThread()`), pauses it for an instant with
`Debugger.pause`, reads the call frames and resumes it.

The pause is delivered through a V8 interrupt, which the main thread handles
at its next JavaScript stack check. A thread stuck in a synchronous system
call is caught as soon as the call returns, still inside it, which is why the
`execSync` above shows up with its caller.

### Why not the CPU profiler

Starting V8's sampling profiler is cheaper than enabling the debugger, but
samples taken right after it starts lose the frame of a function running in
on-stack-replaced (OSR) code. A hot loop is exactly that, so the profiler
blames the loop's caller.

## Cost

While the loop is healthy: one timer and one atomic increment every 50ms on
the main thread, with no measurable change in throughput in our benchmark.

When a stall is caught, the capture holds the main thread a little longer:
`Debugger.enable` reports every loaded script, and the first time it also
hashes their source (about 6ms per MB). Measured on Linux x64, a capture
took 20 to 40ms in a small app (about 100 scripts) and 0.5 to 1 second with
30,000 scripts loaded. Part of that cost comes from V8 capturing a stack trace
for every replayed script; a fix is [in review](https://chromium-review.googlesource.com/c/v8/v8/+/8620014).

Captures only happen when the loop has already been blocked for longer than
the threshold.

## Caveats

- Only the main thread is watched.
- A synchronous call that never returns is reported as blocked, without a
  stack.
- Native code that does not check for V8 interrupts, like `JSON.parse` on a
  huge string, is caught only after it returns, so the stack shows the
  statement that follows it.
- If DevTools or another inspector client has the thread paused at a
  breakpoint, the report says so and leaves the pause alone.
- Under the permission model it needs `--allow-worker`, or it warns and
  stays off. Stacks also need `--allow-inspector` on Node.js versions that
  have it; without it, stalls are reported without a stack. Reading
  `WHY_IS_NODE_BLOCKED_MS` needs `--allow-env`.
- A process that exits right after a stall does not get the "resumed" line.
- Before Node.js 26.1, if the system refuses to start the script (for
  example an environment over the kernel's size limits), the
  `why-is-node-blocked` command aborts instead of printing the error.
  `--import why-is-node-blocked/register` is not affected.

## Compared to

- [`blocked-at`](https://github.com/naugtur/blocked-at) uses `async_hooks` to
  point at where the blocking callback was scheduled, not where it is stuck,
  and adds overhead to every async operation.
- Sentry's SDK detects blocked event loops too, as part of Sentry.
- [`why-is-node-running`](https://github.com/mafintosh/why-is-node-running)
  answers the opposite question: what keeps the process from exiting.

## License

MIT
