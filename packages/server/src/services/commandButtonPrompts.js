import { commandButtons } from '../database.js';

/**
 * Build Command Button API instructions for system prompt if the project has command buttons.
 * @param {string} apiUrl - Base API URL
 * @param {string} sessionId - Current session ID
 * @param {string} projectId - Current project ID
 * @returns {string} Command button instructions or empty string if no buttons configured
 */
export function buildCommandButtonApiInstructions(apiUrl, sessionId, projectId) {
  const buttons = commandButtons.getByProjectId(projectId);
  if (!buttons || buttons.length === 0) {
    return '';
  }

  return `## Command Buttons API

This project has command buttons configured - reusable shell commands you can execute. Use the Bash tool to run these curl commands.

### List Available Buttons
\`\`\`bash
curl ${apiUrl}/api/projects/${projectId}/command-buttons
\`\`\`

### Run a Button
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/${sessionId}/command-buttons/<button_id>/run
\`\`\`

Response: { runId, buttonId, status: "running", output: "" }

### Check Run Status & Output
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}/command-buttons/runs/<run_id>
\`\`\`

Response: { runId, buttonId, status, exitCode, output, startedAt, completedAt }

### List All Runs for This Session
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}/command-buttons/runs
\`\`\`

### Kill a Running Command
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/${sessionId}/command-buttons/runs/<run_id>/kill
\`\`\``;
}
