/**
 * PR/CI indicators ride along on the workspace-card DTO as scalar fields, so
 * the list renders them without fetching a summary per workspace. Shape them
 * back into the summary object `PrIndicators` expects.
 *
 * @param {Object} workspace - A workspace card DTO
 * @returns {Object|null} Summary-shaped PR indicators, or null when there are none
 */
export function workspacePrSummary(workspace) {
  if (!workspace?.prState && !workspace?.hasMergeConflicts && !workspace?.ciStatus) return null;
  return {
    prState: workspace.prState || null,
    hasMergeConflicts: Boolean(workspace.hasMergeConflicts),
    ciStatus: workspace.ciStatus || null,
  };
}
