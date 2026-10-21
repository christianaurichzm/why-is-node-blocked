#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: why-is-node-blocked <script.js> [args...]');
  process.exit(1);
}

const nodeArgs = ['--import', new URL('./register.js', import.meta.url).href, ...args];

// Before Node.js 26.1 a failed execve aborts the process instead of throwing.
// The failure to expect is the binary having been removed while it runs (say,
// by a version manager); the child process path reports that one.
function canExec() {
  if (typeof process.execve !== 'function') return false;
  try {
    accessSync(process.execPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

if (canExec()) {
  try {
    // Becoming the script keeps this PID, so signals from a terminal, a
    // supervisor or `kill` reach it directly and its exit status is ours.
    process.execve(process.execPath, [process.execPath, ...nodeArgs]);
  } catch {
    // Windows has no execve, and from Node.js 26.1 an unexpected failure
    // throws; either way, fall back to a child process.
  }
}

function fail(err) {
  console.error(`why-is-node-blocked: ${err.message}`);
  process.exit(1);
}

// spawn() reports ENOENT and a few others through 'error' but throws the
// rest, E2BIG included.
let child;
try {
  child = spawn(process.execPath, nodeArgs, { stdio: 'inherit' });
} catch (err) {
  fail(err);
}
child.on('error', fail);

// Ctrl+C reaches the child directly through the console or the terminal's
// process group; forwarding SIGINT as well would deliver it twice.
process.on('SIGINT', () => {});
for (const signal of ['SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));

child.on('exit', (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code;
  }
});
