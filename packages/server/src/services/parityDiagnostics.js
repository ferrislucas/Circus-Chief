import { accessSync, constants, existsSync, readFileSync, statSync } from 'fs';
import { delimiter, join } from 'path';
import { isSshAgentSocketAlive } from './loginShellEnv.js';

/**
 * Parity diagnostics for the Muse agent user-shell environment (FR-8,
 * FR-11, FR-12). Pure env + fs checks: no spawns, no secret values in any
 * output. Only presence/absence and origin labels may be disclosed.
 */

/**
 * Keys whose VALUES are secrets: matched by name pattern so future keys are
 * covered by default (FR-11). Boundary-anchored (finding #10): a key must
 * END with a secret suffix (`_TOKEN`, `_SECRET`, `_PASSWORD`, `_PRIVATE`,
 * `_PAT`, `_KEY`, or the exact API_KEY shape / bare noun) to count — keys
 * that merely CONTAIN these mid-name (PATH_TO_TOKENS_DIR, TOKENIZER_HOME)
 * are benign, and scrubbing their values corrupted every agent's tool logs.
 * The `^` anchor still covers exact bare names (TOKEN, PAT, API_KEY).
 */
export const SECRET_KEY_PATTERN = /(^|_)(TOKEN|SECRET|PASSWORD|PRIVATE|PAT|KEY)$|API_KEY/i;

/**
 * Resolve a binary against an env PATH (no shell-out). Returns the absolute
 * path or null. Never throws.
 * @param {Object} env
 * @param {string} name - Binary name or explicit path (honors MUSE_BIN-style).
 * @returns {string|null}
 */
export function findExecutableOnPath(env, name) {
  if (!name) return null;
  try {
    if (name.includes('/')) {
      accessSync(name, constants.X_OK);
      return name;
    }
    const separator = process.platform === 'win32' ? ';' : delimiter;
    for (const dir of String(env?.PATH || '').split(separator)) {
      if (!dir) continue;
      const candidate = join(dir, name);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        /* try next dir */
      }
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

/**
 * Resolve a launcher (bare name like `muse`, or an explicit path) to the
 * absolute executable path it would run as under `env`. Explicit paths are
 * returned unchanged; an unresolvable bare name is returned unchanged too,
 * so the caller's own stat/exec surfaces the familiar ENOENT.
 *
 * Finding #1: Node resolves child-process executables against the *server
 * process* PATH, not `options.env` — so anything that execs a bare launcher
 * must resolve it through the derived host env first (the same env the
 * parity gate validated and the real spawn receives).
 *
 * @param {Object} env - The env whose PATH governs resolution.
 * @param {string} name - Launcher name or explicit path.
 * @returns {string|null}
 */
export function resolveLauncherAbsolutePath(env, name) {
  if (!name || name.includes('/')) return name;
  return findExecutableOnPath(env, name) || name;
}

function dirExists(dir) {
  if (!dir) return false;
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(file) {
  try {
    return existsSync(file);
  } catch {
    return false;
  }
}

function ghHostsFileExists(home) {
  if (!home) return false;
  return fileExists(join(home, '.config', 'gh', 'hosts.yml'));
}

function stripGitconfigComments(content) {
  return String(content)
    .split('\n')
    .filter((line) => !/^\s*[#;]/.test(line))
    .join('\n');
}

function gitconfigSectionHasIdentity(content, section = 'user') {
  const cleaned = stripGitconfigComments(content);
  const match = cleaned.match(new RegExp(`\\[${section}\\][^[]*`, 'i'))?.[0] || '';
  return /name\s*=/i.test(match) && /email\s*=/i.test(match);
}

function gitconfigIncludePaths(content, home) {
  const cleaned = stripGitconfigComments(content);
  const includeSection = cleaned.match(/\[include\][^[]*/i)?.[0] || '';
  const paths = [];
  for (const line of includeSection.split('\n')) {
    const match = line.match(/^\s*path\s*=\s*(.+?)\s*$/i);
    if (!match) continue;
    const raw = match[1];
    paths.push(raw.startsWith('~/') ? join(home, raw.slice(2)) : raw);
  }
  return paths;
}

function gitconfigHasIdentity(home) {
  if (!home) return false;
  let content;
  try {
    content = readFileSync(join(home, '.gitconfig'), 'utf8');
  } catch {
    return false;
  }
  if (gitconfigSectionHasIdentity(content)) return true;
  // Identity may live in an included file (e.g. dotfile-managed splits).
  for (const includePath of gitconfigIncludePaths(content, home)) {
    try {
      if (gitconfigSectionHasIdentity(readFileSync(includePath, 'utf8'))) return true;
    } catch {
      /* unreadable include: keep looking */
    }
  }
  return false;
}

function binarySignals(env) {
  const specs = [
    ['muse-bin', env?.MUSE_BIN || 'muse', 'Install Muse Code and ensure `muse` is on PATH (or set MUSE_BIN).'],
    ['git-bin', 'git', 'Install git and ensure it is on the login-shell PATH.'],
    ['gh-bin', 'gh', 'Install the GitHub CLI and ensure it is on the login-shell PATH.'],
  ];
  return specs.map(([signal, name, remediation]) => {
    const resolved = findExecutableOnPath(env, name);
    return { signal, ok: Boolean(resolved), origin: resolved || 'not on PATH', remediation: resolved ? null : remediation };
  });
}

function homeSignal(env) {
  const ok = dirExists(env?.HOME);
  return {
    signal: 'home',
    ok,
    origin: env?.HOME ? 'HOME value' : 'unset',
    remediation: ok ? null : (env?.HOME ? `HOME directory missing: ${env.HOME}` : 'HOME is not set for the server process.'),
  };
}

function identitySignal(env) {
  const identity = env?.USER || env?.LOGNAME;
  return {
    signal: 'identity',
    ok: Boolean(identity),
    origin: identity || 'unset',
    remediation: identity ? null : 'USER/LOGNAME are not set; tools cannot resolve a consistent user identity.',
  };
}

function sshAgentSignal(env) {
  const ssh = isSshAgentSocketAlive(env?.SSH_AUTH_SOCK);
  return {
    signal: 'ssh-agent',
    ok: ssh.alive,
    origin: env?.SSH_AUTH_SOCK ? 'socket path' : 'unset',
    remediation: ssh.alive ? null
      : 'SSH agent not reachable. Run `ssh-add -l` in your terminal; if you launched Circus Chief from Finder/a service, relaunch it from your terminal so SSH_AUTH_SOCK is inherited.',
  };
}

function ghAuthSignal(env) {
  const tokenSet = Boolean(env?.GH_TOKEN || env?.GITHUB_TOKEN);
  const hostsFile = ghHostsFileExists(env?.HOME);
  const ok = tokenSet || hostsFile;
  return {
    signal: 'gh-auth',
    ok,
    origin: tokenSet ? 'token env' : (hostsFile ? 'hosts file' : 'none'),
    remediation: ok ? null
      : 'gh is not authenticated for the agent shell. Run `gh auth login` (or `gh auth status`) in your terminal and relaunch the server from there.',
  };
}

function gitIdentitySignal(env) {
  const fromEnv = Boolean(
    (env?.GIT_AUTHOR_NAME && env?.GIT_AUTHOR_EMAIL)
    || (env?.GIT_COMMITTER_NAME && env?.GIT_COMMITTER_EMAIL),
  );
  const fromFile = gitconfigHasIdentity(env?.HOME);
  const ok = fromEnv || fromFile;
  return {
    signal: 'git-identity',
    ok,
    origin: fromEnv ? 'GIT_* env' : (fromFile ? 'gitconfig' : 'none'),
    remediation: ok ? null
      : 'No git identity visible (GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL or user.name/user.email in ~/.gitconfig). Set `git config --global user.name/user.email` in your terminal.',
  };
}

/**
 * Per-signal parity check over a fully-built host env (FR-12 data source).
 * Binary signals can be skipped for hermetic tests via `opts.skipBinaries`.
 *
 * @param {Object} env - Built host env (e.g. buildMuseHostEnv output).
 * @param {Object} [opts] - `{ skipBinaries?: boolean }`.
 * @returns {Array<{ signal: string, ok: boolean, origin: string, remediation: string|null }>}
 */
export function checkParitySignals(env, opts = {}) {
  return [
    ...(opts.skipBinaries ? [] : binarySignals(env)),
    homeSignal(env),
    identitySignal(env),
    sshAgentSignal(env),
    ghAuthSignal(env),
    gitIdentitySignal(env),
  ];
}

const PARITY_ERRORS = {
  'ssh-agent': {
    code: 'MUSE_SSH_AGENT_UNREACHABLE',
    message: 'Muse couldn\'t reach your SSH agent (SSH_AUTH_SOCK not available to the server process). '
      + 'Run `ssh-add -l` in your terminal; if you launched Circus Chief from Finder/a service, '
      + 'relaunch it from your terminal so the agent inherits SSH_AUTH_SOCK.',
  },
  'gh-auth': {
    code: 'MUSE_GH_UNAUTHENTICATED',
    message: 'Muse couldn\'t authenticate gh (no GH_TOKEN/GITHUB_TOKEN and no gh hosts file visible). '
      + 'Run `gh auth status` in your terminal; if it succeeds there, relaunch Circus Chief from your '
      + 'terminal so the agent inherits the same credentials.',
  },
  'git-identity': {
    code: 'MUSE_GIT_IDENTITY_MISSING',
    message: 'Muse couldn\'t find your git identity (no GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL and no '
      + 'user.name/user.email in ~/.gitconfig). Run `git config --global user.name "You"` and '
      + '`git config --global user.email "you@example.com"` in your terminal.',
  },
  'home': {
    code: 'MUSE_HOME_MISSING',
    message: 'Muse couldn\'t resolve your HOME directory, so tools that read ~/.config, '
      + '~/.gitconfig, and gh hosts will misbehave. Relaunch Circus Chief from your terminal '
      + 'so the agent inherits HOME.',
  },
  'identity': {
    code: 'MUSE_IDENTITY_MISSING',
    message: 'Muse couldn\'t determine your user identity (USER/LOGNAME are not set), so tools '
      + 'fall back to inconsistent defaults. Relaunch Circus Chief from your terminal so the '
      + 'agent inherits your login identity.',
  },
  'muse-bin': {
    code: 'MUSE_CLI_NOT_FOUND',
    message: 'Muse CLI not found. Install Muse Code and ensure `muse` is on PATH (or set MUSE_BIN).',
  },
};

/**
 * Actionable, secret-free error for an unsatisfiable parity signal (FR-8).
 * Caller-provided values are never interpolated into the message (FR-11).
 * @param {'ssh-agent'|'gh-auth'|'git-identity'|'home'|'identity'|'muse-bin'} kind
 * @returns {Error} With `.code` set.
 */
export function buildParityCredentialError(kind) {
  const spec = PARITY_ERRORS[kind] || PARITY_ERRORS['ssh-agent'];
  const err = new Error(spec.message);
  err.code = spec.code;
  return err;
}

/** Parity-relevant keys summarized by redactEnvForDiagnostics. */
const DIAGNOSTIC_KEYS = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'MUSE_BIN',
  'SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'GH_TOKEN', 'GITHUB_TOKEN', 'EDITOR',
];

function pathEntryCount(value) {
  return String(value).split(process.platform === 'win32' ? ';' : ':').filter(Boolean).length;
}

/**
 * Redacted environment summary for logs and diagnostics (FR-11): per key,
 * only `{ state: 'SET'|'UNSET', origin }` — never the value. Origin labels
 * where the value came from: 'login-shell' (matches the probed baseline),
 * 'explicit' (server process / session / provider config), or 'unset'.
 * PATH additionally reports its entry count (not the entries).
 *
 * @param {Object} env - Built host env.
 * @param {Object} [opts] - `{ shellEnv }` baseline for origin labels.
 * @returns {Object<string, { state: string, origin: string, entries?: number }>}
 */
export function redactEnvForDiagnostics(env, opts = {}) {
  const shellEnv = opts.shellEnv || {};
  const summary = {};
  for (const key of DIAGNOSTIC_KEYS) {
    const value = env?.[key];
    if (value === undefined || value === null || value === '') {
      summary[key] = { state: 'UNSET', origin: 'unset' };
      continue;
    }
    const entry = {
      state: 'SET',
      origin: shellEnv[key] !== undefined && String(shellEnv[key]) === String(value) ? 'login-shell' : 'explicit',
    };
    if (key === 'PATH') entry.entries = pathEntryCount(value);
    summary[key] = entry;
  }
  return summary;
}

/**
 * Scrub secret values (by key pattern) from free text: server logs, error
 * messages surfaced to the UI/canvas, transcripts, diagnostics (FR-11).
 * Non-secret values pass through untouched.
 * @param {string} text
 * @param {Object} env - Env holding the secret values to scrub.
 * @returns {string}
 */
export function redactSecretsFromText(text, env) {
  const values = new Set();
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value === 'string' && value && SECRET_KEY_PATTERN.test(key)) {
      values.add(value);
    }
  }
  return replaceSecretValuesWithRedacted(text, values);
}

function replaceSecretValuesWithRedacted(text, values) {
  let out = String(text ?? '');
  for (const value of [...values].sort((a, b) => b.length - a.length)) {
    out = out.split(value).join('[REDACTED]');
  }
  return out;
}

/**
 * Cache of tokens harvested from the gh hosts file, keyed by path + mtime so
 * the file is read once per change (≈ once per turn) rather than per scrubbed
 * event. Tokens live in memory only — never logged or persisted.
 */
let ghHostsTokenCache = { key: null, tokens: [] };

/** Reset the harvested-token cache (tests). */
export function __resetGhHostsTokenCacheForTest() {
  ghHostsTokenCache = { key: null, tokens: [] };
}

/**
 * Harvest `oauth_token` values from the gh CLI's `hosts.yml` (FR-6) for the
 * per-turn scrub value set (finding #2). gh credentials often live only in
 * that file — no env var — so a tool output echoing them would otherwise
 * bypass the env-keyed scrub. Guarded: a missing/unreadable file yields no
 * extra values. Values are held in memory only and never disclosed.
 *
 * @param {Object} [env] - Env providing HOME (defaults to process.env).
 * @returns {string[]}
 */
export function harvestGhHostsTokens(env = process.env) {
  const home = env?.HOME;
  if (!home) return [];
  const hostsPath = join(home, '.config', 'gh', 'hosts.yml');
  try {
    const mtimeMs = statSync(hostsPath).mtimeMs;
    const key = `${hostsPath}:${mtimeMs}`;
    if (ghHostsTokenCache.key === key) return ghHostsTokenCache.tokens;
    const content = readFileSync(hostsPath, 'utf8');
    const tokens = [];
    for (const match of content.matchAll(/^\s*oauth_token:\s*(\S+)\s*$/gm)) {
      tokens.push(match[1]);
    }
    ghHostsTokenCache = { key, tokens };
    return tokens;
  } catch {
    return [];
  }
}

/**
 * The per-session scrub value set (finding #2): secret-keyed values from the
 * turn env merged over `process.env`, plus gh-hosts oauth tokens. Single
 * source for the transcript path — tool inputs, tool outputs, and assistant
 * text all scrub against this exact set.
 *
 * @param {Object} [env] - Turn session env carrying secret values.
 * @returns {Set<string>}
 */
export function scrubValuesForSession(env) {
  const merged = { ...process.env, ...(env || {}) };
  const values = new Set();
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'string' && value && SECRET_KEY_PATTERN.test(key)) {
      values.add(value);
    }
  }
  for (const token of harvestGhHostsTokens(merged)) {
    values.add(token);
  }
  return values;
}

/**
 * Scrub secret values out of text bound for work logs (finding #1, FR-11).
 * Single choke point for the transcript path: tool inputs, tool outputs,
 * and assistant text are redacted here before reaching work logs (and from
 * there transcripts and canvas payloads). `env` is the turn's session env —
 * provider-supplied tokens live there, not in the server process env — merged
 * over `process.env` so both are covered, plus gh-hosts harvested tokens
 * (finding #2). Only secret *values* are scrubbed; key names and presence
 * labels survive.
 *
 * The Muse event mapper is intentionally NOT a scrub point: it is pure
 * (no env access), so mapped `tool_result` content passes through verbatim
 * and is scrubbed here.
 *
 * @param {*} text - Text (or value stringified by the caller) to scrub.
 * @param {Object} [env] - Session env carrying secret values.
 * @returns {string} Scrubbed text with secret values replaced by `[REDACTED]`.
 */
export function scrubEventForLogging(text, env) {
  return replaceSecretValuesWithRedacted(text, scrubValuesForSession(env));
}
