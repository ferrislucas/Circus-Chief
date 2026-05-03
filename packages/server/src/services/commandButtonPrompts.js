import { commandButtons } from '../database.js';

/**
 * Build Command API instructions for system prompt if the project has commands.
 * @param {string} apiUrl - Base API URL
 * @param {string} sessionId - Current session ID
 * @param {string} projectId - Current project ID
 * @returns {string} Command instructions or empty string if no commands configured
 */
export function buildCommandButtonApiInstructions(apiUrl, sessionId, projectId) {
  const buttons = commandButtons.getByProjectId(projectId);
  if (!buttons || buttons.length === 0) {
    return '';
  }

  return `## Commands API

This project has commands configured - reusable shell commands you can execute. Use the Bash tool to run these curl commands.

### List Available Commands
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}/command-buttons
\`\`\`

### Run a Command
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/${sessionId}/command-buttons/<button_id>/run
\`\`\`

Response: { runId, buttonId, status: "running", output: "" }

### Check Run Status & Output
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}/command-buttons/runs/<run_id>
\`\`\`

Response: { runId, buttonId, status, exitCode, output, startedAt, completedAt }

### List Command Runs
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}/command-buttons/runs
\`\`\`

### Kill a Running Command
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/${sessionId}/command-buttons/runs/<run_id>/kill
\`\`\``;
}
