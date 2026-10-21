import { watch } from '../../index.js';

watch({ thresholdMs: 200 });
function blockingFunction() {
  const end = Date.now() + 600;
  while (Date.now() < end);
}
setTimeout(blockingFunction, 50);
setTimeout(() => {}, 900);
