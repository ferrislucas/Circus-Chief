let stopping = false;
const inFlight = new Set();

export function beginLaneEntryDelivery() {
  stopping = false;
}

export function isLaneEntryDeliveryStopping() {
  return stopping;
}

export function trackLaneEntryDelivery(promise) {
  const tracked = Promise.resolve(promise).finally(() => inFlight.delete(tracked));
  inFlight.add(tracked);
  return tracked;
}

/** Stop new delivery and drain every producer's active work within a bound. */
export async function stopLaneEntryDelivery(timeoutMs = 5_000, getRetryInFlight = () => null) {
  stopping = true;
  const deadline = Date.now() + timeoutMs;
  while (inFlight.size || getRetryInFlight()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      console.warn(`Kanban shutdown timed out with ${inFlight.size} delivery operation(s) still in flight`);
      return;
    }
    const pending = [...inFlight];
    const retry = getRetryInFlight();
    if (retry) pending.push(retry);
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => setTimeout(resolve, remaining)),
    ]);
  }
}
