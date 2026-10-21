function blockingFunction() {
  const end = Date.now() + 600;
  while (Date.now() < end);
}
setTimeout(blockingFunction, 50);
// Keeps the process running after the stall, like a server would.
setTimeout(() => {}, 900);
