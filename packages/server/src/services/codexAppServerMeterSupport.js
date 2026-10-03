export function parseCodexMinorVersion(versionOutput) {
  const match = String(versionOutput).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return -1;
  return Number(match[1]) * 1000 + Number(match[2]);
}

// app-server (and the account rate-limit API) ships in codex-cli 0.145.0+.
const MIN_SUPPORTED_MINOR = 145;
const VERSION_CHECK_TIMEOUT_MS = 5_000;

// Client metadata for the app-server handshake: a stable, credential-free
// identifier (the protocol requires initialization before any other request;
// codex-cli 0.145.0 silently drops requests sent before it).
export const CLIENT_INFO = Object.freeze({
  name: 'circuschief-allowance-meter',
  title: 'Circus Chief',
  version: '1.0.0',
});

/**
 * Version gate for the meter: true when the installed Codex CLI speaks
 * app-server. Never throws — an undetectable binary simply disables the
 * meter instead of failing loudly.
 */
export async function checkCodexVersionSupported(execFileAsync) {
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFileAsync('codex', ['--version'], { timeout: VERSION_CHECK_TIMEOUT_MS }, (error, output) => {
        if (error) reject(error);
        else resolve(String(output));
      });
    });
    return parseCodexMinorVersion(stdout) >= MIN_SUPPORTED_MINOR;
  } catch {
    return false;
  }
}

export function resolveCodexAllowanceProvider(modelProviders) {
  const providers = modelProviders?.getEnabledForAllowances?.() ?? [];
  return providers.find((provider) => provider?.isBuiltIn === true && provider.kind === 'openai') ?? null;
}

/**
 * Build the meter child's env from the currently eligible provider's auth
 * context. The result carries live credentials: it is never logged, never
 * serialized into snapshots or broadcasts, and is consumed only as process
 * spawn env. The meter re-resolves the provider on every (re)spawn, so this
 * env is always fresh — no stale credential outlives a rotation or disable.
 */
export function buildCodexMeterEnv(provider, inheritedEnv = process.env) {
  const env = { ...inheritedEnv };
  if (provider?.baseUrl) env.OPENAI_BASE_URL = provider.baseUrl;
  if (provider?.authToken) env.OPENAI_API_KEY = provider.authToken;
  if (provider?.additionalEnvVars && typeof provider.additionalEnvVars === 'object') Object.assign(env, provider.additionalEnvVars);
  return env;
}

// Structured, credential-free diagnostics (plan §9.4).
export function logCodexMeterOutcome(entry) {
  console.log('[CodexAppServerMeter]', JSON.stringify(entry));
}
