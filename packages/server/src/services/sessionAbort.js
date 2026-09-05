const userStoppedControllers = new WeakSet();

export const USER_STOP_ABORT_REASON = Object.freeze(new Error('Stopped by user'));

/** Abort a provider turn while retaining the provenance of the user action. */
export function abortForUserStop(controller) {
  if (!controller) return;
  userStoppedControllers.add(controller);
  controller.abort(USER_STOP_ABORT_REASON);
}

/** True only for controllers explicitly stopped through the user stop path. */
export function isUserStopAbort(controller) {
  return Boolean(controller && (
    userStoppedControllers.has(controller)
    || controller.signal?.reason === USER_STOP_ABORT_REASON
  ));
}
