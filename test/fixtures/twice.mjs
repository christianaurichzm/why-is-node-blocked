import { watch } from '../../index.js';

let firstReady = false;
watch({ thresholdMs: 200 }).then(() => (firstReady = true));
await watch({ thresholdMs: 200 });
console.log(firstReady);
