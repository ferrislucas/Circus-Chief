/** Wait for the environment before enabling any delivery of session work. */
export async function startWorkAfterEnvironment({ warm, isShuttingDown, startLaneWorker, startScheduler, listen }) {
  await warm();
  if (isShuttingDown()) return;
  startLaneWorker();
  startScheduler();
  if (!isShuttingDown()) listen();
}
