/**
 * Builds the durable, safe-by-default summary of tool input AND SDK-supplied
 * presentation strings persisted into work-log/session history (database
 * rows, REST history responses, and WebSocket history broadcasts all read
 * from the same persisted content).
 *
 * This is intentionally NOT a redaction pass over the raw input. Key-name
 * matching (e.g. hiding fields named "token" or "secret") is not a valid
 * security boundary: arbitrary scalar tool input — a Bash command, a Write
 * body, an Edit replacement string — can carry secrets under any field name,
 * or as free text with no field name at all (an embedded URL credential, an
 * Authorization header baked into a shell command). The only safe contract
 * is an allowlist: for each known tool, name the specific fields that are
 * safe to keep, and copy nothing else. Unknown tools and unknown fields are
 * omitted entirely rather than persisted "just in case".
 *
 * The same reasoning applies to the SDK's presentation fields on a
 * `canUseTool` request. `title` is documented as the "full permission prompt
 * sentence rendered by the bridge (e.g. 'Claude wants to read foo.txt')" —
 * for a Bash approval that sentence embeds the *exact command*, credentials
 * and all. `decisionReason` ("explains why this permission request was
 * triggered") can quote the same content. Neither has a structural safety
 * guarantee, so neither is ever persisted, in full or truncated — a
 * truncated secret is still a secret. `displayName` is documented as a
 * "short noun phrase for the tool action (e.g. 'Read file')" and is used
 * instead as the durable headline, with a defensive length cap: if it is
 * ever longer than a short label should be, it is omitted rather than kept
 * in a shortened form.
 *
 * The live approval card is unaffected by this module — it renders the raw,
 * transient `payload.input`/`title`/`description`/`decisionReason` directly
 * so the user has full context to decide. Only what gets written to durable
 * history goes through this allowlist.
 */

const SAFE_PATH_FIELDS_BY_TOOL = {
  Write: ['file_path'], Edit: ['file_path'], MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'], Read: ['file_path'],
};

// A durable log must not become an inventory of a user's filesystem.  The
// request does not carry a trusted workspace root, so it cannot prove that a
// path is workspace-relative; keeping any path (including its basename)
// would disclose names such as customers, home directories, or secrets.
// Search, glob, command, description, and URL values are arbitrary free text
// under a different key and are likewise deliberately absent.  Additions to
// this allowlist require an explicit, safe transformation—not raw retention.
const REDACTED_PATH = '[path omitted]';

export function buildSafeToolInputSummary(toolName, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const allowedFields = SAFE_PATH_FIELDS_BY_TOOL[toolName];
  if (!allowedFields) return {};

  const summary = {};
  for (const field of allowedFields) {
    if (!(field in input) || typeof input[field] !== 'string') continue;
    summary[field] = REDACTED_PATH;
  }
  return summary;
}

// Bridge-supplied `displayName` is documented as a short noun phrase (e.g.
// "Read file"), structurally unlike `title` (a full sentence that can embed
// raw tool input). It is still treated as untrusted content: only kept if it
// fits the shape of a short label, omitted — never truncated — otherwise.
const MAX_HEADLINE_LENGTH = 80;

export function buildSafeHeadline(displayName, toolName) {
  if (typeof displayName === 'string' && displayName.trim() && displayName.length <= MAX_HEADLINE_LENGTH) {
    return displayName.trim();
  }
  return `${toolName || 'Unknown tool'} permission request`;
}

// `blockedPath` is bridge-provided and has no trusted workspace context, so
// preserve only the fact that a path caused the block.  This also covers URLs
// and Windows paths without relying on fragile credential-pattern detection.
export function buildSafeBlockedPath(blockedPath) {
  return typeof blockedPath === 'string' && blockedPath ? REDACTED_PATH : null;
}

// Permission-denied events also contain bridge-provided free text (`message`
// and `decision_reason`). Keep only bounded structural fields in durable
// history; the interactive prompt retains the rich transient context.
export function buildSafeDenialSummary({ toolName, decisionReasonType, agentId }) {
  const safeToolName = typeof toolName === 'string' && toolName ? toolName : 'Unknown tool';
  const safeReasonType = typeof decisionReasonType === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(decisionReasonType)
    ? decisionReasonType
    : null;
  const safeAgentId = typeof agentId === 'string' && agentId.length > 0 && agentId.length <= 128
    ? agentId
    : null;
  return [
    `Permission denied for ${safeToolName}`,
    safeReasonType && `Reason type: ${safeReasonType}`,
    safeAgentId && `Agent: ${safeAgentId}`,
  ].filter(Boolean).join('\n');
}
