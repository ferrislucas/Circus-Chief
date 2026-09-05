import crypto from 'crypto';

/**
 * Environment variable names that Codex itself uses or that are reserved for
 * Circus Chief control flow. Stdio MCP `env` entries whose key matches any of
 * these names are silently dropped — they must not be forwarded to the MCP
 * child via env_vars, and their values must not be injected into the Codex
 * spawn environment.
 *
 * Codex's own env (process.env keys and the session-supplied env object) is
 * also blocked; this set covers names that should be blocked even when absent
 * from the base env at spawn time.
 */
export const CODEX_RESERVED_MCP_ENV_NAMES = new Set(['OPENAI_API_KEY', 'CODEX_HOME']);

/**
 * Serialize an mcpServers map into repeated `-c` CLI args for the Codex CLI,
 * with credential values moved out of argv into the spawned process environment.
 *
 * Generates config keys under `mcp_servers.<serverName>` using the Codex
 * `mcp_servers` schema. Supported keys per server type:
 *   Remote: url, bearer_token_env_var, env_http_headers
 *   Stdio:  command, args, env_vars, cwd, startup_timeout_sec
 *
 * Credential values (bearer tokens, header values) for remote servers are
 * placed into a returned `env` map under collision-resistant generated variable
 * names (`CIRCUSCHIEF_MCP_<SANITIZED_PARTS>_<HASH>`), and config args reference
 * those variable names instead of literal credential values.
 *
 * Stdio `env` string values are forwarded under their original `.mcp.json` key
 * names. Codex's `env_vars` whitelist forwards variables by name from Codex's
 * own environment to the stdio MCP child; it cannot rename them. Using original
 * key names means the MCP child sees the expected variable names (e.g. `API_KEY`
 * rather than a generated `CIRCUSCHIEF_MCP_*` name).
 *
 * Keys from `baseEnv` combined with {@link CODEX_RESERVED_MCP_ENV_NAMES} form the
 * blocked set: stdio env entries whose key is blocked are dropped and logged.
 * Same-name keys across multiple accepted MCP servers remain last-write-wins.
 * `env_vars` is emitted only when at least one accepted key remains.
 *
 * @param {Object} mcpServers
 * @param {Object} [opts]
 * @param {Object|null} [opts.baseEnv] - The Codex spawn base environment. Keys
 *   from this map block same-named stdio MCP env entries from being forwarded.
 * @returns {{ args: string[], env: Object }} args are flat '-c'/value pairs;
 *   env holds credential values to merge into the Codex spawn environment.
 */
export function serializeMcpServersToArgs(mcpServers, { baseEnv = null } = {}) {
  const effectiveEnv = baseEnv && typeof baseEnv === 'object' ? baseEnv : process.env;
  const blockedEnvNames = new Set([...Object.keys(effectiveEnv), ...CODEX_RESERVED_MCP_ENV_NAMES]);
  const args = [];
  const env = {};
  for (const [serverName, server] of Object.entries(mcpServers)) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) continue;
    const prefix = `mcp_servers.${tomlKey(serverName)}`;
    let result;
    if (server.type === 'sse' || server.type === 'http') {
      result = serializeRemoteMcpServer(prefix, serverName, server);
    } else {
      result = serializeStdioMcpServer(prefix, serverName, server, { blockedEnvNames });
    }
    args.push(...result.args);
    Object.assign(env, result.env);
  }
  return { args, env };
}

/**
 * Serialize a remote (sse/http) MCP server using the Codex HTTP schema.
 *
 * Emits `url`, `bearer_token_env_var`, and `env_http_headers`. Does NOT emit
 * `type` or literal credential values in argv. Bearer Authorization values and
 * all other string headers are moved into the spawn environment under generated
 * variable names.
 *
 * @param {string} prefix
 * @param {string} serverName
 * @param {Object} server
 * @returns {{ args: string[], env: Object }}
 */
function serializeRemoteMcpServer(prefix, serverName, server) {
  if (typeof server.url !== 'string' || server.url.length === 0) return { args: [], env: {} };

  const args = ['-c', `${prefix}.url=${tomlStr(server.url)}`];
  const env = {};

  const headers = (server.headers && typeof server.headers === 'object' && !Array.isArray(server.headers))
    ? server.headers
    : {};

  // Convert Authorization: Bearer <token> to bearer_token_env_var.
  // Non-Bearer Authorization strings fall through to env_http_headers below.
  const authEntry = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization');
  const bearerToken = extractBearerToken(authEntry);
  let authConsumedAsBearer = false;
  if (bearerToken !== null) {
    const varName = makeMcpEnvVarName(serverName, 'BEARER_TOKEN');
    env[varName] = bearerToken;
    args.push('-c', `${prefix}.bearer_token_env_var=${tomlStr(varName)}`);
    authConsumedAsBearer = true;
  }

  // Convert remaining string headers to env_http_headers.
  // Non-Bearer Authorization headers are included here alongside other headers.
  const otherStringHeaders = Object.entries(headers)
    .filter(([k, v]) => {
      if (k.toLowerCase() === 'authorization') return !authConsumedAsBearer && typeof v === 'string';
      return typeof v === 'string';
    });

  if (otherStringHeaders.length > 0) {
    const headerEnvMap = {};
    for (const [headerName, headerValue] of otherStringHeaders) {
      const varName = makeMcpEnvVarName(serverName, 'HDR', headerName);
      env[varName] = headerValue;
      headerEnvMap[headerName] = varName;
    }
    const tableStr = `{${Object.entries(headerEnvMap).map(([k, v]) => `${tomlKey(k)}=${tomlStr(v)}`).join(',')}}`;
    args.push('-c', `${prefix}.env_http_headers=${tableStr}`);
  }

  return { args, env };
}

/**
 * Resolve accepted stdio MCP env entries, filtering out blocked keys.
 *
 * Returns an object with the accepted key-value pairs to inject into the Codex
 * spawn environment and list in `env_vars`. Returns null when no entries remain
 * after filtering (non-string values and blocked keys are excluded).
 *
 * Logs a warning when keys are dropped because they match blocked names.
 *
 * @param {string} serverName
 * @param {unknown} serverEnv
 * @param {Set<string>} blockedEnvNames
 * @returns {{ envVarNames: string[], envValues: Object }|null}
 */
function resolveStdioMcpEnv(serverName, serverEnv, blockedEnvNames) {
  if (!serverEnv || typeof serverEnv !== 'object' || Array.isArray(serverEnv)) return null;
  const skippedKeys = [];
  const envValues = {};
  const envVarNames = [];
  for (const [key, value] of Object.entries(serverEnv)) {
    if (typeof value !== 'string') continue;
    if (blockedEnvNames.has(key)) { skippedKeys.push(key); continue; }
    envValues[key] = value;
    envVarNames.push(key);
  }
  if (skippedKeys.length > 0) {
    console.warn('[CodexAdapter] dropped MCP stdio env keys that would override Codex env:', { serverName, keys: skippedKeys });
  }
  return envVarNames.length > 0 ? { envVarNames, envValues } : null;
}

/**
 * Serialize a stdio MCP server using the Codex stdio schema.
 *
 * Emits `command`, `args`, `env_vars`, `cwd`, and `startup_timeout_sec`.
 * Does NOT emit `type` or literal env values in argv. Stdio `env` string
 * values are injected into the spawn environment under their original
 * `.mcp.json` key names, and those key names are listed in `env_vars`.
 * Blocked keys (from {@link serializeMcpServersToArgs}) are dropped silently
 * via {@link resolveStdioMcpEnv}.
 *
 * @param {string} prefix
 * @param {string} serverName
 * @param {Object} server
 * @param {Object} [opts]
 * @param {Set<string>} [opts.blockedEnvNames]
 * @returns {{ args: string[], env: Object }}
 */
function serializeStdioMcpServer(prefix, serverName, server, { blockedEnvNames = new Set() } = {}) {
  if (typeof server.command !== 'string' || server.command.length === 0) return { args: [], env: {} };

  const args = ['-c', `${prefix}.command=${tomlStr(server.command)}`];
  const env = {};

  if (Array.isArray(server.args)) {
    const strArgs = server.args.filter((a) => typeof a === 'string');
    args.push('-c', `${prefix}.args=[${strArgs.map(tomlStr).join(',')}]`);
  }

  const stdioEnv = resolveStdioMcpEnv(serverName, server.env, blockedEnvNames);
  if (stdioEnv) {
    Object.assign(env, stdioEnv.envValues);
    args.push('-c', `${prefix}.env_vars=[${stdioEnv.envVarNames.map(tomlStr).join(',')}]`);
  }

  if (typeof server.cwd === 'string' && server.cwd.length > 0) {
    args.push('-c', `${prefix}.cwd=${tomlStr(server.cwd)}`);
  }

  if (Number.isFinite(server.startup_timeout_sec)) {
    args.push('-c', `${prefix}.startup_timeout_sec=${server.startup_timeout_sec}`);
  }

  return { args, env };
}

/**
 * Extract a trimmed Bearer token from an Authorization header entry.
 * Returns the token string, or null if the entry is not a valid non-empty Bearer value.
 *
 * @param {[string, unknown]|undefined} authEntry - [headerName, headerValue] pair or undefined
 * @returns {string|null}
 */
function extractBearerToken(authEntry) {
  if (!authEntry) return null;
  const [, authValue] = authEntry;
  if (typeof authValue !== 'string') return null;
  const match = authValue.match(/^Bearer\s+(.+)/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Generate a collision-resistant environment variable name for an MCP credential field.
 * Pattern: CIRCUSCHIEF_MCP_<SANITIZED_PARTS>_<HASH>
 *
 * Each segment is uppercased and non-alphanumeric characters are replaced with '_'
 * to form a readable prefix. A short deterministic suffix (first 8 hex chars of a
 * SHA-256 digest over the raw segment values) prevents collisions between inputs
 * whose sanitized forms are identical (e.g. 'X-Custom' and 'X.Custom' both map to
 * 'X_CUSTOM' but receive different hashes).
 *
 * @param {string} serverName
 * @param {...string} parts - Additional segments (e.g. 'BEARER_TOKEN', 'ENV', 'API_KEY')
 * @returns {string}
 */
function makeMcpEnvVarName(serverName, ...parts) {
  const allParts = [serverName, ...parts];
  const segments = allParts.map((s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '_'));
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(allParts))
    .digest('hex')
    .slice(0, 8);
  return `CIRCUSCHIEF_MCP_${segments.join('_')}_${hash}`;
}

/**
 * Serialize a string as a TOML basic string (JSON-compatible double-quoting).
 * @param {string} s
 * @returns {string}
 */
function tomlStr(s) {
  return JSON.stringify(s);
}

/**
 * Return a TOML key segment: bare if safe ([A-Za-z0-9_-]), quoted otherwise.
 * @param {string} s
 * @returns {string}
 */
function tomlKey(s) {
  if (/^[A-Za-z0-9_-]+$/.test(s)) return s;
  return JSON.stringify(s);
}
