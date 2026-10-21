// process.chdir() is allowed on the main thread and throws in workers.
process.chdir(process.cwd());
