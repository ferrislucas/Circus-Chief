/** Shape scalar workspace-card PR fields for the existing indicator component. */
export function workspacePrSummary(workspace) {
  if (!workspace?.prState && !workspace?.hasMergeConflicts && !workspace?.ciStatus) return null;
  return {
    prState: workspace.prState || null,
    hasMergeConflicts: Boolean(workspace.hasMergeConflicts),
    ciStatus: workspace.ciStatus || null,
  };
}
