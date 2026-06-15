/**
 * Pure mapping helper that turns a set of latest command runs into the
 * button-status indicators shown on session cards and kanban cards.
 *
 * Kept free of stores/reactivity so it stays cheap and reusable from both
 * a `computed` (single-session card) and a board-level loop (kanban board).
 *
 * @param {Record<string, { id: string, label: string, command: string, showOnList?: boolean }>} buttonMap
 *   Map of buttonId → command-button definition.
 * @param {Array<{ buttonId: string, status: string }>} latestRuns
 *   Latest command runs for a session.
 * @returns {Array<{ buttonId: string, label: string, command: string, status: string, latestRun: object }>}
 */
export function mapRunsToButtonStatuses(buttonMap, latestRuns) {
  if (!buttonMap || !Array.isArray(latestRuns)) return [];

  return latestRuns
    .filter(run => buttonMap[run.buttonId]?.showOnList)
    .map(run => ({
      buttonId: run.buttonId,
      label: buttonMap[run.buttonId].label,
      command: buttonMap[run.buttonId].command,
      status: run.status,
      latestRun: run,
    }));
}
