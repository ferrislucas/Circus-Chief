/**
 * Classify a git subprocess error into a structured category.
 *
 * Implemented with a small set of substring tables rather than a long chain of
 * `||` conditions so the dispatcher stays well under the cyclomatic-complexity
 * limit. Category order matters: the first match wins.
 */

/** Substring patterns that indicate a credential/auth failure. */
const CREDENTIAL_PATTERNS = [
  'terminal prompts disabled',
  'could not read username',
  'could not read password',
  'authentication failed',
  'http 401',
  'http 403',
  '403 forbidden',
  '401 unauthorized',
];

/** Substring patterns that indicate an SSH/access permission failure. */
const PERMISSION_PATTERNS = [
  'permission denied',
  'publickey',
  'access denied',
];

/** Substring patterns that indicate the remote is unreachable or absent. */
const REMOTE_UNREACHABLE_PATTERNS = [
  'repository not found',
  'not found',
  'does not exist',
  'unable to connect',
  'could not resolve host',
  'name or service not known',
  'network is unreachable',
  'connection refused',
  'connection timed out',
  'no route to host',
];

function matchesAny(text, patterns) {
  return patterns.some((p) => text.includes(p));
}

/**
 * Classify a git error into a structured category based on stderr/message content.
 * @param {Error} err
 * @param {string} command - The git command that failed (e.g. 'git fetch origin')
 * @returns {{ code: string, message: string, detail: string, remediation: string }}
 */
export function classifyGitError(err, command = '') {
  const text = [err.message || '', err.stderr || '', err.stdout || ''].join(' ').toLowerCase();

  if (err.killed || text.includes('timed out') || text.includes('timeout')) {
    return {
      code: 'git_timeout',
      message: `Git command timed out: ${command}`,
      detail: 'The git operation did not complete within the allowed time.',
      remediation: 'Check that the remote is reachable and try again. If the remote is slow, consider increasing GIT_TIMEOUT_MS.',
    };
  }

  if (matchesAny(text, CREDENTIAL_PATTERNS)) {
    return {
      code: 'git_credential_required',
      message: 'Git authentication failed.',
      detail: 'The remote requires credentials that were not provided or were rejected.',
      remediation: 'Sign in or refresh credentials for the git host, then retry session creation.',
    };
  }

  if (matchesAny(text, PERMISSION_PATTERNS)) {
    return {
      code: 'git_permission_denied',
      message: 'Git permission denied.',
      detail: 'SSH key or access permissions are not configured for this remote.',
      remediation: 'Verify your SSH key is added to the git host and has access to this repository.',
    };
  }

  if (matchesAny(text, REMOTE_UNREACHABLE_PATTERNS)) {
    return {
      code: 'git_remote_unreachable',
      message: 'Git could not reach the remote repository.',
      detail: 'The configured remote may be unreachable or the repository may not exist.',
      remediation: 'Check the project remote URL and make sure this machine can reach the git host.',
    };
  }

  return {
    code: 'git_unknown',
    message: `Git command failed: ${err.message || command}`,
    detail: 'An unexpected git error occurred.',
    remediation: 'Check the server logs for more details.',
  };
}
