import { sessions, projects, kanbanBoards, kanbanLanes } from '../database.js';
import { getApiBaseUrl } from './apiBaseUrl.js';

/** Build workspace and session CRUD operations section */
function buildSessionCrudOps(apiUrl, projectId, sessionId, workspaceId) {
  return `### Create a New Workspace
\`\`\`bash
curl -X POST ${apiUrl}/api/projects/${projectId}/workspaces \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Your task description here"}'
\`\`\`
Use this to **start a completely new line of work**. Only \`prompt\` is required.
Optional fields: \`name\`, \`mode\`, \`thinkingEnabled\` (boolean), \`effortLevel\` (low/medium/high/max/auto), \`model\`, \`providerId\`, \`gitBranch\`, \`gitMode\`, \`templateId\`, \`nextTemplateId\`, \`startImmediately\`, \`scheduledAt\` (ISO 8601 date-time string with timezone, e.g. \`"2026-06-12T14:00:00Z"\`), \`autoRescheduleEnabled\`, \`rescheduleDelayMinutes\`, \`rescheduleOnTokenLimit\`, \`rescheduleOnServiceError\`, \`maxRescheduleCount\`, \`maxTotalTokens\`, and \`rescheduleAtTokenCount\`.

### Add a Session to this Workspace
\`\`\`bash
curl -X POST ${apiUrl}/api/workspaces/${workspaceId}/sessions \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Your task description here", "parentSessionId": "${sessionId}"}'
\`\`\`
Use this to **continue work inside the current workspace**. \`parentSessionId\` is required — pass \`"parentSessionId": "${sessionId}"\` to chain the new session directly after the current one, or \`"parentSessionId": "${workspaceId}"\` to attach it directly to the workspace root instead.
Optional fields: same as creating a workspace. Add \`scheduledAt\` to schedule the new session without starting it immediately. Only schedule a new *workspace* when starting genuinely independent work; for continuations, schedule a *session within this workspace* instead.

**Note:** "workspace" here refers to a group of related sessions. This is distinct from the Codex \`workspace-write\` sandbox mode — those are separate concepts.

### Send a Follow-up Message
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/<session_id>/message \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Your follow-up message"}'
\`\`\`

### List All Active Sessions / Get Session Details / Get Messages
\`\`\`bash
curl ${apiUrl}/api/sessions
curl ${apiUrl}/api/sessions/<session_id>
curl ${apiUrl}/api/sessions/<session_id>/messages
\`\`\`

### List Workspaces / Get Workspace Detail
\`\`\`bash
curl ${apiUrl}/api/projects/${projectId}/workspaces
curl ${apiUrl}/api/workspaces/${workspaceId}
\`\`\`

### Stop / Restart / Delete a Session
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/<session_id>/stop
curl -X POST ${apiUrl}/api/sessions/<session_id>/restart
curl -X DELETE ${apiUrl}/api/sessions/<session_id>
\`\`\`

### Update Session Settings
\`\`\`bash
curl -X PATCH ${apiUrl}/api/sessions/<session_id> \\
  -H "Content-Type: application/json" \\
  -d '{"thinkingEnabled": true, "effortLevel": "high"}'
\`\`\`

### Schedule Current Session to Continue Later
Use this single call to schedule **this session** to resume with a given prompt.
This is the preferred, race-free alternative to the multi-step PATCH dance.
Works whether the session is idle or still running (the schedule survives the turn-completion).
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/${sessionId}/schedule \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Continue: <work to resume>", "scheduledAt": "<future ISO 8601 timestamp>"}'
\`\`\`
Required fields: \`prompt\` (string), \`scheduledAt\` (ISO 8601 string or epoch ms, must be in the future).
Optional field: \`model\` (string) — sets pendingModel; validated and guarded against cross-kind switches.
Only \`prompt\`, \`scheduledAt\`, and \`model\` are honored by this endpoint. Set reschedule policy fields via session creation or \`PATCH /api/sessions/:id\`.`;
}

/** Build project and summary operations section */
function buildProjectOps(apiUrl, sessionId) {
  return `### Project Operations
\`\`\`bash
curl ${apiUrl}/api/projects                          # List all projects
curl ${apiUrl}/api/projects/<project_id>             # Get project details
curl ${apiUrl}/api/projects/<project_id>/sessions    # List project sessions
curl -X POST ${apiUrl}/api/projects \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Project Name", "workingDirectory": "/path/to/directory"}'
\`\`\`
Optional field: \`systemPrompt\`

### Workflow Summary
\`\`\`bash
curl "${apiUrl}/api/sessions/${sessionId}/summary?generate=true"
curl -X POST ${apiUrl}/api/sessions/${sessionId}/summary  # Regenerate
\`\`\``;
}

/**
 * Build the workflow-completion contract section, included only when this
 * session participates in an open structured Kanban lane run (session has a
 * lane_run_id). Ending a turn is intentionally insufficient to advance a
 * structured lane's card — the participating session must explicitly close
 * its own-work obligation. See FRD "Kanban Lane-Run Structured Completion".
 * @param {string} sessionId
 * @returns {string} Instructions, or '' when this session is not a lane-run participant
 */
export function buildWorkflowCompletionInstructions(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session?.laneRunId) return '';

  const apiUrl = getApiBaseUrl();
  return `## Workflow Completion (Structured Kanban Lane Run)

This session is part of an active structured Kanban lane run. **Finishing a turn does not, by itself, advance the Kanban card.** You must explicitly tell the system your own work is done.

1. Fetch your current \`workflowTurnToken\` (always re-fetch — it changes on every retry/continuation):
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}
\`\`\`
2. Once your own work for this turn is genuinely finished (not paused, not waiting on a scheduled continuation), call:
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/${sessionId}/workflow/complete \\
  -H "Content-Type: application/json" \\
  -d '{"turnToken": "<workflowTurnToken from step 1>", "idempotencyKey": "<any unique string for this request>"}'
\`\`\`

Notes:
- If you schedule further work for yourself (via \`POST /api/sessions/${sessionId}/schedule\`) or a required descendant session is still open, do **not** call this endpoint — the run correctly waits for that work instead.
- A stale or already-superseded \`turnToken\` is rejected; re-fetch the session and retry.
- This call is idempotent for the same \`idempotencyKey\`; retry safely on network errors.`;
}

/** Build session API instructions for Claude to create/modify sessions */
export function buildSessionApiInstructions(sessionId, projectId) {
  const apiUrl = getApiBaseUrl();
  // Compute the workspace ID (= root session ID) for this session. This is
  // needed so agents can reference the current workspace in API calls without
  // having to walk the parent chain themselves.
  const workspaceId = sessions.getRootSessionId(sessionId) || sessionId;
  return `## Session Management API

You can create and modify sessions in this system using curl or similar HTTP tools. Use the Bash tool to execute these commands.

**Base URL:** ${apiUrl}
**Current Session ID:** ${sessionId}
**Current Project ID:** ${projectId}
**Current Workspace ID:** ${workspaceId}

${buildSessionCrudOps(apiUrl, projectId, sessionId, workspaceId)}

${buildProjectOps(apiUrl, sessionId)}`;
}

/**
 * Build Kanban API instructions for system prompt.
 * @param {string} sessionId - Current session ID
 * @param {string} projectId - Current project ID
 * @returns {string} Kanban instructions or empty string if the project is missing
 */
export function buildKanbanApiInstructions(sessionId, projectId) {
  const project = projects.getById(projectId);
  if (!project) {
    return '';
  }

  const apiUrl = getApiBaseUrl();
  // Compute the workspace id for this session — the agent uses workspace
  // addressing for all kanban operations.
  const workspaceId = sessions.getRootSessionId(sessionId) || sessionId;
  const board = kanbanBoards.getByProjectId(projectId);

  // Get lane names for context
  let laneContext = '';
  if (board) {
    const lanes = kanbanLanes.getByBoardId(board.id);
    if (lanes && lanes.length > 0) {
      const laneList = lanes.map((l) => `  - "${l.name}" (ID: ${l.id})`).join('\n');
      laneContext = `\n### Available Lanes\n${laneList}\n`;
    }
  }

  return `## Kanban Board API

This project has a Kanban board enabled for organizing sessions visually. You can manage the board using these API endpoints.

Note: Moving a workspace card moves all sessions in the workspace together.
${laneContext}
### Get Board with All Lanes and Cards
\`\`\`bash
curl ${apiUrl}/api/projects/${projectId}/kanban
\`\`\`

### Add Current Workspace to the Board
\`\`\`bash
curl -X POST ${apiUrl}/api/projects/${projectId}/kanban/cards \\
  -H "Content-Type: application/json" \\
  -d '{"workspaceId": "${workspaceId}", "laneId": "<lane_id>"}'
\`\`\`

### Move a Card to a Different Lane
\`\`\`bash
curl -X PATCH ${apiUrl}/api/projects/${projectId}/kanban/cards/by-workspace/${workspaceId}/move \\
  -H "Content-Type: application/json" \\
  -d '{"targetLaneId": "<lane_id>"}'
\`\`\`

### Remove a Card from the Board
\`\`\`bash
curl -X DELETE ${apiUrl}/api/projects/${projectId}/kanban/cards/by-workspace/${workspaceId}
\`\`\`

### Create a New Lane
\`\`\`bash
curl -X POST ${apiUrl}/api/projects/${projectId}/kanban/lanes \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Lane Name"}'
\`\`\`

### Update a Lane
\`\`\`bash
curl -X PATCH ${apiUrl}/api/projects/${projectId}/kanban/lanes/<lane_id> \\
  -H "Content-Type: application/json" \\
  -d '{"name": "New Name"}'
\`\`\`

### Delete a Lane
\`\`\`bash
curl -X DELETE ${apiUrl}/api/projects/${projectId}/kanban/lanes/<lane_id>
\`\`\``;
}
