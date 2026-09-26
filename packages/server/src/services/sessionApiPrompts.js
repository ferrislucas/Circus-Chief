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

### List Providers & Available Models
\`\`\`bash
curl ${apiUrl}/api/providers
\`\`\`
Returns configured providers, each with \`kind\` (\`anthropic\` | \`openai\` | \`google\`) and a \`models\` array of \`{modelId, displayName, tier, enabled, lifecycle}\`. Use a listed \`models[].modelId\` to discover the currently available model choices for new workspaces/sessions. This is a discoverability list, not an exhaustive validation contract: validation also accepts SDK tier aliases (such as \`fable\`, \`opus\`, \`sonnet\`, and \`haiku\`) and can retain historical model IDs that are not listed.

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

function buildLaneContext(projectId) {
  const board = kanbanBoards.getByProjectId(projectId);
  if (!board) {
    return '';
  }

  const lanes = kanbanLanes.getByBoardId(board.id);
  if (!lanes?.length) {
    return '';
  }

  const laneList = lanes.map((lane) => `  - "${lane.name}" (ID: ${lane.id})`).join('\n');
  return `\n### Available Lanes\n${laneList}\n`;
}

/** Build the lane request-field documentation shared by create and update */
function buildLaneFieldDocs() {
  return `### Lane Request Fields
For \`POST /lanes\`, \`name\` is the only required field (a non-empty string). All other shared fields below are optional and accepted on both create and update. \`PATCH /lanes/:laneId\` is a partial update: omitted fields preserve their current values, while explicit \`null\` clears nullable settings.

- \`name\` — non-empty string; lane display name.
- \`sortOrder\` — number; requested lane position (not card ordering).
- \`onEnterTemplateId\` — UUID string or null; template used for entry automation.
- \`onEnterPrompt\` — string or null; prompt used for entry automation.
- \`onEnterMode\` — \`plan\`, \`standard\`, or \`yolo\`, or null; entry session mode.
- \`onEnterModel\` — string or null; entry session model identifier.
- \`onEnterProviderId\` — UUID string or null; provider that owns \`onEnterModel\`. Only needed to disambiguate when the same model id is registered under more than one provider; \`null\` lets the server resolve the provider from the model.
- \`onEnterEffortLevel\` — \`low\`, \`medium\`, \`high\`, \`max\`, or \`auto\`, or null; entry session reasoning effort.
- \`onEnterThinkingEnabled\` — boolean or null; entry session thinking setting.
- \`onEnterAutoRescheduleEnabled\` — boolean; enables automatic rescheduling.
- \`onEnterRescheduleDelayMinutes\` — number; delay before automatic rescheduling.
- \`onEnterRescheduleOnTokenLimit\` — boolean; reschedule after a token-limit failure.
- \`onEnterRescheduleOnServiceError\` — boolean; reschedule after a service failure.
- \`onEnterMaxRescheduleCount\` — number or null; maximum automatic reschedules.
- \`onEnterMaxTotalTokens\` — number or null; total token cap for the entry workflow.
- \`onEnterRescheduleAtTokenCount\` — number or null; token count that triggers a continuation reschedule.
- \`completionTargetLaneId\` — UUID string or null; destination lane after successful completion. It must be a different lane on the same board; \`null\` clears the destination.

\`onEnterTemplateId\` and a non-blank \`onEnterPrompt\` are mutually exclusive: never send both. To replace template automation with prompt automation, set \`onEnterPrompt\` and \`onEnterTemplateId: null\`; to replace prompt automation with template automation, set \`onEnterTemplateId\` and \`onEnterPrompt: null\`. Omitting either property preserves its existing value.

Completion routing requires on-entry automation: a create or update that sets \`completionTargetLaneId\` must also give the lane on-entry automation via \`onEnterTemplateId\` or a non-blank \`onEnterPrompt\` — in the same request, or through an earlier update. Otherwise the request fails with \`KANBAN_LANE_AUTOMATION_REQUIRED\`.`;
}

/** Build workspace card operations section */
function buildKanbanCardOps(apiUrl, projectId, workspaceId) {
  return `### Add Current Workspace to the Board
\`\`\`bash
curl -X POST ${apiUrl}/api/projects/${projectId}/kanban/cards \\
  -H "Content-Type: application/json" \\
  -d '{"workspaceId": "${workspaceId}", "laneId": "<lane_id>"}'
\`\`\`

### Move this Workspace's Card
\`\`\`bash
curl -X PUT ${apiUrl}/api/projects/${projectId}/kanban/cards/by-workspace/${workspaceId}/lane \\
  -H "Content-Type: application/json" \\
  -d '{"laneId":"<lane_id>"}'
\`\`\`
### Remove a Card from the Board
\`\`\`bash
curl -X DELETE ${apiUrl}/api/projects/${projectId}/kanban/cards/by-workspace/${workspaceId}
\`\`\``;
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
  const workspaceId = sessions.getRootSessionId(sessionId) || sessionId;
  const laneContext = buildLaneContext(projectId);

  return `## Kanban Board API

This project has a Kanban board enabled for organizing sessions visually. You can manage the board using these API endpoints.

Note: Moving a workspace card moves all sessions in the workspace together.
${laneContext}
### Get Board with All Lanes and Cards
\`\`\`bash
curl ${apiUrl}/api/projects/${projectId}/kanban
\`\`\`
Read the board before changing settings that depend on existing lanes (completion routing or reordering). Its response is the authoritative source for current settings and lane IDs; use those returned IDs rather than guessing. The displayed lane list, when present, is convenience context only.

${buildLaneFieldDocs()}

${buildKanbanCardOps(apiUrl, projectId, workspaceId)}

### Create a New Lane
\`\`\`bash
curl -X POST ${apiUrl}/api/projects/${projectId}/kanban/lanes \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Lane Name"}'
\`\`\`

### Create a Lane with Prompt Automation
\`\`\`bash
curl -X POST ${apiUrl}/api/projects/${projectId}/kanban/lanes \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Testing","onEnterPrompt":"Run the test suite and report failures.","onEnterMode":"standard","onEnterModel":"gpt-5.6","onEnterEffortLevel":"high","onEnterThinkingEnabled":true,"onEnterAutoRescheduleEnabled":true,"onEnterRescheduleDelayMinutes":15,"onEnterRescheduleOnTokenLimit":true,"onEnterRescheduleOnServiceError":true,"onEnterMaxRescheduleCount":2,"onEnterMaxTotalTokens":500000,"onEnterRescheduleAtTokenCount":400000}'
\`\`\`

### Update a Lane
\`\`\`bash
curl -X PATCH ${apiUrl}/api/projects/${projectId}/kanban/lanes/<lane_id> \\
  -H "Content-Type: application/json" \\
  -d '{"name": "New Name"}'
\`\`\`

### Set Completion Routing
After reading the board and using its returned IDs, route successful completion to a different lane on the same board. The source lane must have on-entry automation, so this example configures it in the same request (omit \`onEnterPrompt\` when the lane already has automation):
\`\`\`bash
curl -X PATCH ${apiUrl}/api/projects/${projectId}/kanban/lanes/<lane_id> \\
  -H "Content-Type: application/json" \\
  -d '{"onEnterPrompt":"Continue with the next workflow stage.","completionTargetLaneId":"<target_lane_id>"}'
\`\`\`

### Clear Lane Automation and Completion Routing
Disable entry automation and clear the completion destination explicitly:
\`\`\`bash
curl -X PATCH ${apiUrl}/api/projects/${projectId}/kanban/lanes/<lane_id> \\
  -H "Content-Type: application/json" \\
  -d '{"onEnterTemplateId":null,"onEnterPrompt":null,"completionTargetLaneId":null}'
\`\`\`

### Reorder Lanes
Use this canonical deterministic lane-order operation after reading the board. The body is the complete desired order of lane UUIDs, not a card-order request:
\`\`\`bash
curl -X PUT ${apiUrl}/api/projects/${projectId}/kanban/lanes/reorder \\
  -H "Content-Type: application/json" \\
  -d '["<lane_id_1>","<lane_id_2>"]'
\`\`\`

### Delete a Lane
\`\`\`bash
curl -X DELETE ${apiUrl}/api/projects/${projectId}/kanban/lanes/<lane_id>
\`\`\``;
}
