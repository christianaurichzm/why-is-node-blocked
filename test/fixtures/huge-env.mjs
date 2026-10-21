// A preload in NODE_OPTIONS can grow the environment past what execve takes.
process.env.HUGE = 'x'.repeat(128 * 1024);
