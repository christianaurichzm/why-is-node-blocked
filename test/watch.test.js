import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { watch } from '../index.js';

const env = { ...process.env, WHY_IS_NODE_BLOCKED_MS: '200' };
const node = (...args) =>
  spawnSync(process.execPath, args, { encoding: 'utf8', env, timeout: 20_000 });

test('reports the blocking function and how long the loop was blocked', () => {
  const { status, stderr } = node('--import', './register.js', 'test/fixtures/busy.mjs');
  assert.equal(status, 0, stderr);
  assert.match(stderr, /event loop blocked for over 200ms\n {4}at blockingFunction \(.*busy\.mjs:3:\d+\)/);
  assert.match(stderr, /event loop resumed after \d+ms/);
});

test('stays quiet and lets the process exit when nothing blocks', () => {
  // The default threshold: a slow CI disk can hold the main thread for a few
  // hundred milliseconds while it loads the entry point, a real stall that a
  // 200ms threshold reports.
  const { status, signal, stderr } = spawnSync(process.execPath, ['--import', './register.js', 'test/fixtures/idle.mjs'], {
    encoding: 'utf8',
    env: { ...env, WHY_IS_NODE_BLOCKED_MS: '' },
    timeout: 20_000,
  });
  assert.equal(signal, null);
  assert.equal(status, 0);
  assert.equal(stderr, '');
});

test('delivers the event to onBlock instead of stderr', () => {
  const { status, stdout, stderr } = node('test/fixtures/api.mjs');
  assert.equal(status, 0, stderr);
  assert.equal(stderr, '');
  const event = JSON.parse(stdout);
  assert.ok(event.durationMs >= 200, `durationMs ${event.durationMs}`);
  assert.equal(event.stack[0].functionName, 'blockingFunction');
});

test('a second watch() call waits for the same watcher', () => {
  const { status, stdout, stderr } = node('test/fixtures/twice.mjs');
  assert.equal(status, 0, stderr);
  assert.equal(stdout, 'true\n');
});

for (const via of ['channel', 'hook']) {
  test(`a watch() call from instrumentation during startup keeps the first call's options (${via})`, () => {
    const { status, stdout, stderr } = node('test/fixtures/reentrant.mjs', via);
    assert.equal(status, 0, stderr);
    assert.equal(stdout, '1 worker, same promise: true\nonBlock\n');
  });
}

test('warns and lets the app run when the watcher cannot start', () => {
  const { status, stderr } = node('--enable-sharedarraybuffer-per-context', '--import', './register.js', 'test/fixtures/idle.mjs');
  assert.equal(status, 0, stderr);
  assert.match(stderr, /why-is-node-blocked is disabled: SharedArrayBuffer is not defined/);
});

test('leaves a pause held by another debugger client alone', () => {
  const { status, stdout, stderr } = node('--import', './register.js', 'test/fixtures/debugger.mjs');
  assert.equal(status, 0, stderr);
  assert.ok(Number(stdout) >= 750, `paused for ${stdout.trim()}ms`);
  assert.match(stderr, /\(the main thread is paused in a debugger\)/);
});

test('reports without a stack under the permission model instead of crashing', () => {
  const { status, signal, stderr } = node('--permission', '--allow-worker', '--allow-fs-read=*', 'test/fixtures/permission.mjs');
  assert.equal(signal, null, stderr);
  assert.equal(status, 0, stderr);
  assert.match(stderr, /event loop blocked for over 200ms\n {4}\(stack unavailable: the permission model denies the inspector\)/);
});

test("keeps the app's preloads out of the watcher thread", () => {
  const { status, stderr } = spawnSync(process.execPath, ['--import', './register.js', 'test/fixtures/busy.mjs'], {
    encoding: 'utf8',
    env: { ...env, NODE_OPTIONS: '--require ./test/fixtures/chdir-preload.cjs' },
    timeout: 20_000,
  });
  assert.equal(status, 0, stderr);
  assert.match(stderr, /at blockingFunction/);
});

test('the CLI runs the script with the watcher loaded', () => {
  const { status, stderr } = node('cli.js', 'test/fixtures/busy.mjs');
  assert.equal(status, 0, stderr);
  assert.match(stderr, /at blockingFunction/);
});

test('rejects invalid options', () => {
  assert.throws(() => watch({ thresholdMs: 0 }), RangeError);
  assert.throws(() => watch({ thresholdMs: '1000' }), RangeError);
  assert.throws(() => watch({ onBlock: 'log' }), TypeError);
});

test('the CLI reports a missing Node.js binary instead of aborting', () => {
  const { status, signal, stderr } = node('--import', './test/fixtures/missing-node.mjs', 'cli.js', 'test/fixtures/idle.mjs');
  assert.equal(signal, null, stderr);
  assert.equal(status, 1);
  assert.match(stderr, /why-is-node-blocked: .*ENOENT/);
});

const [major, minor] = process.versions.node.split('.').map(Number);
const execveThrows = major > 26 || (major === 26 && minor >= 1);

test('the CLI reports an environment the kernel refuses', { skip: (process.platform !== 'linux' || !execveThrows) && 'needs Linux and Node.js 26.1+' }, () => {
  const { signal, status, stderr } = node('--import', './test/fixtures/huge-env.mjs', 'cli.js', 'test/fixtures/idle.mjs');
  assert.equal(signal, null, stderr);
  assert.equal(status, 1);
  assert.match(stderr, /why-is-node-blocked: .*E2BIG/);
});

test("the CLI exits with the script's exit code", () => {
  const { status } = node('cli.js', 'test/fixtures/does-not-exist.mjs');
  assert.equal(status, 1);
});

test('the CLI becomes the script, so a SIGINT sent to its PID alone reaches it', { skip: process.platform === 'win32' && 'no execve' }, async () => {
  // A large but valid environment must not push the CLI off the execve path.
  for (const extra of [{}, { LARGE: 'x'.repeat(80 * 1024) }]) {
    const cli = spawn(process.execPath, ['cli.js', 'test/fixtures/forever.mjs'], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'inherit'] });
    const [chunk] = await once(cli.stdout, 'data');
    assert.equal(Number(String(chunk).trim()), cli.pid);
    cli.kill('SIGINT');
    const [, signal] = await once(cli, 'exit');
    assert.equal(signal, 'SIGINT');
  }
});
