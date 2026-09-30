import { createRequire } from 'node:module';
import { DEFAULT_TIMEOUTS } from './museTimeouts.js';
import { buildMuseHostEnv } from './museHostEnv.js';

const require = createRequire(import.meta.url);
export const MUSE_SDK_VERSION = require('@muse-code/sdk/package.json').version;

/**
 * MSP handshake identity. `name` must match ^[a-z0-9_]+$ (SS1.4.1) — the
 * host rejects anything else (including 'circus-chief' with a hyphen) at
 * `initialize`, which would break every Muse session. `version` tracks the
 * installed SDK so a stale handshake never misidentifies the client.
 */
export const MUSE_CLIENT_INFO = Object.freeze({ name: 'circus_chief', version: MUSE_SDK_VERSION });

/**
 * Resolve the `muse serve` argv for one host lifetime.
 *
 * Sandbox posture is fixed at spawn and not negotiable over the wire, while
 * the approval mode travels per-session — so the host's sandbox flag is
 * derived from the session's approval mode: `allowAll` (yolo) runs
 * unsandboxed, like Codex `danger-full-access` / Claude `bypassPermissions`,
 * and every gated mode keeps the default sandbox. Fail-closed: anything that
 * is not `allowAll` keeps sandboxing enabled.
 *
 * `--trust-workspace` is orthogonal (loads workspace skills/rules) and always kept.
 *
 * @param {Object} [options] - Turn options carrying `approvalMode`
 * @returns {string[]}
 */
export function resolveMuseServeArgs({ approvalMode } = {}) {
  const args = ['serve', '--trust-workspace'];
  if (approvalMode === 'allowAll') args.push('--disable-sandbox');
  return args;
}

/**
 * Default client factory: lazy-import the SDK so the server stays bootable
 * in environments where the optional dependency is not installed, and spawn
 * an owned `muse serve` host.
 */
export async function spawnMuseClient({ museBin, args, env, onStderr, shutdownTimeoutMs }) {
  let MuseClient;
  try {
    ({ MuseClient } = await import('@muse-code/sdk'));
  } catch (err) {
    const missing = new Error(
      'Muse support requires the "@muse-code/sdk" package. Run `yarn add @muse-code/sdk` in packages/server.'
    );
    missing.code = 'MUSE_SDK_NOT_INSTALLED';
    missing.cause = err;
    throw missing;
  }
  return MuseClient.spawn({
    museBin,
    args: args ?? resolveMuseServeArgs(),
    // The SDK REPLACES the child env: extend the session env (which already
    // carries the robust PATH plus provider vars) instead of inheriting raw.
    // Hardened again here so the live spawn never depends on the caller
    // having gone through _openHost (idempotent with it).
    env: buildMuseHostEnv(env),
    clientInfo: { ...MUSE_CLIENT_INFO },
    ...(onStderr ? { onStderr } : {}),
    shutdownTimeoutMs: shutdownTimeoutMs ?? DEFAULT_TIMEOUTS.shutdownGraceMs,
  });
}

export async function openMspSession(client, options) {
  const startOptions = {
    ...(options.cwd ? { workspaceRoot: options.cwd } : {}),
    ...(options.model ? { modelId: options.model } : {}),
    ...(options.approvalMode ? { approvalMode: options.approvalMode } : {}),
  };
  if (options.resume) {
    try {
      return await client.resumeSession({ sessionId: options.resume, ...startOptions });
    } catch (err) {
      console.warn(`[MuseAdapter] MSP resume failed (${err?.message || err}); starting a fresh session.`);
    }
  }
  return client.startSession(startOptions);
}
