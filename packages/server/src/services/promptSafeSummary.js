/**
 * Builds the durable, safe-by-default summary of tool input persisted into
 * work-log/session history (database rows, REST history responses, and
 * WebSocket history broadcasts all read from the same persisted content).
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
 * The live approval card is unaffected by this module — it renders the raw,
 * transient `payload.input` directly so the user has full context to decide.
 * Only what gets written to durable history goes through this allowlist.
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
