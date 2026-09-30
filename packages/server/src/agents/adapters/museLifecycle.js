/**
 * Lifecycle logging for the Muse adapter's owned-host lifetime. Extracted
 * from MuseAdapter.js so the adapter stays under the repo's size gates
 * without a file-level eslint-disable.
 */
export function logMuseLifecycle({ correlationId, hostPid, museSessionId, sdkVersion, cliVersion, timings, phase }) {
  console.info(`[MuseAdapter] correlationId=${correlationId} phase=${phase} hostPid=${hostPid ?? 'unavailable'} museSessionId=${museSessionId ?? 'pending'} sdkVersion=${sdkVersion} cliVersion=${cliVersion ?? 'unknown'} timings=${JSON.stringify(timings)}`);
}
