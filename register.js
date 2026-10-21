import { watch } from './index.js';

watch({ thresholdMs: Number(process.env.WHY_IS_NODE_BLOCKED_MS) || undefined });
