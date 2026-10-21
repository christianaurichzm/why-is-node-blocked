import { watch } from './index.js';

// Awaited so the app starts once the watcher thread is running; see watch()
// for how long it waits.
await watch({ thresholdMs: Number(process.env.WHY_IS_NODE_BLOCKED_MS) || undefined });
