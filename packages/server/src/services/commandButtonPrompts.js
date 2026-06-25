/**
 * Build Command API instructions for system prompt.
 * Always included so agents know commands may be available and can discover them.
 * @param {string} apiUrl - Base API URL
 * @param {string} sessionId - Current session ID
 * @returns {string} Command instructions
 */
export function buildCommandButtonApiInstructions(apiUrl, sessionId) {
  return `## Circus Commands

This project may have Circus Commands configured - reusable shell commands you can execute. Use the Bash tool to run these curl commands.

> When the user asks to "run a command", "what commands are available", "list circus commands", or similar, use the Commands API below to discover and execute them.

### List Available Commands
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}/circus-commands
\`\`\`

### Run a Command
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/${sessionId}/circus-commands/<button_id>/run
\`\`\`

Response: { runId, buttonId, status: "running", output: "" }

### Check Run Status & Output
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}/circus-commands/runs/<run_id>
\`\`\`

Response: { runId, buttonId, status, exitCode, output, startedAt, completedAt }

### List Command Runs
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}/circus-commands/runs
\`\`\`

### Kill a Running Command
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/${sessionId}/circus-commands/runs/<run_id>/kill
\`\`\``;
}
