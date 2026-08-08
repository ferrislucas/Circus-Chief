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

const SAFE_INPUT_FIELDS_BY_TOOL = {
  Bash: ['description'],
  Write: ['file_path'],
  Edit: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Read: ['file_path'],
  Glob: ['pattern', 'path'],
  Grep: ['pattern', 'path', 'glob'],
  WebFetch: ['url'],
  WebSearch: ['query'],
  Task: ['description', 'subagent_type'],
};

// Fields whose string values may themselves embed credentials (e.g.
// `https://user:token@host/...` or a `?api_key=...` query string) even
// though the field itself is allowlisted.
const URL_LIKE_FIELDS = new Set(['url']);

export function buildSafeToolInputSummary(toolName, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const allowedFields = SAFE_INPUT_FIELDS_BY_TOOL[toolName];
  if (!allowedFields) return {};

  const summary = {};
  for (const field of allowedFields) {
    if (!(field in input) || typeof input[field] !== 'string') continue;
    summary[field] = URL_LIKE_FIELDS.has(field) ? stripUrlCredentials(input[field]) : input[field];
  }
  return summary;
}

function stripUrlCredentials(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[omitted: unparseable url]';
  }
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

// `blockedPath` is documented as "the file path that triggered the
// permission request" — expected to be a filesystem path, not a URL, so it
// is not run through `stripUrlCredentials` (most paths fail `new URL()`).
// Query strings, fragments, and userinfo-style credentials are stripped by
// shape while the path itself is preserved for context.
export function buildSafeBlockedPath(blockedPath) {
  if (typeof blockedPath !== 'string' || !blockedPath) return null;
  const withoutFragment = blockedPath.split('#')[0];
  const withoutQuery = withoutFragment.split('?')[0];
  // Strip a userinfo-style `user:pass@` (or bare `token@`) segment wherever
  // it appears in the path, not just after a URL-style `//` prefix — a
  // blockedPath is a filesystem path, not necessarily a URL.
  return withoutQuery.replace(/\/[^/]*@/, '/');
}
