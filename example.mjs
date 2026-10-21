// npx why-is-node-blocked example.mjs
import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

function resizeImage() {
  const end = Date.now() + 2000;
  while (Date.now() < end);
}

function isValidEmail(email) {
  return /^(\w+)*@/.test(email);
}

function gitRevision() {
  return execSync('sleep 2; echo abc123').toString();
}

await sleep(100);
resizeImage();
await sleep(100);
isValidEmail('a'.repeat(25) + '!');
await sleep(100);
gitRevision();
await sleep(300);
