import { watch } from '../../index.js';

await watch({ thresholdMs: 200, onBlock: (event) => console.log(JSON.stringify(event)) });
function blockingFunction() {
  const end = Date.now() + 600;
  while (Date.now() < end);
}
setTimeout(blockingFunction, 50);
setTimeout(() => {}, 1000);
