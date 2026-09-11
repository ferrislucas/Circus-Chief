import { readFileSync, writeFileSync } from 'fs';

// ─────────────────────────────────────────────────────────────────────────
// Scripted outcomes (Phase 1 of model-tiers-e2e-coverage-plan.md)
//
// A test-only script file (E2E_AGENT_SPAWN_SCRIPT_FILE), written by the
// Playwright test BEFORE seeding a session, queues outcomes per
// (providerId, modelId) pair so the failover Playwright suite can force a
// specific member to fail (quota / service-outage / auth / bad-request /
// cancellation / delayed success / assistant-output-then-error) while every
// other member behaves normally, without ever touching real provider
// credentials.
//
// File shape:
//   {
//     "queues": { "<providerId>::<modelId>": ["quota_error", "success", ...] },
//     "default": "success"
//   }
// Queue entries may be a shorthand outcome-type string or an object
// `{ type, message?, delayMs?, failDelayMs? }` to override the default
// message/timing for that single attempt. Queues are consumed FIFO and
// persisted back to disk immediately so serial E2E runs see each subsequent
// spawn attempt advance to the next scripted outcome.
// ─────────────────────────────────────────────────────────────────────────

const SCRIPT_ENV_KEY = 'E2E_AGENT_SPAWN_SCRIPT_FILE';

export const DEFAULT_OUTCOME = Object.freeze({ type: 'success' });

export const OUTCOME_MESSAGES = {
  quota_error: 'Quota exceeded: you have run out of tokens for this billing period',
  rate_limit: '429 Too many requests: rate limit exceeded, please retry later',
  service_unavailable: '503 Service Unavailable: the upstream service is temporarily unavailable',
  overloaded: '529 Overloaded: the API is temporarily overloaded, please retry',
  auth_error: '401 Unauthorized: invalid API key provided',
  bad_request: '400 Bad Request: invalid request parameters',
};

// Failover-eligible outcome types (must satisfy matchesStartFailoverEligibleError
// in sessionErrors.js) vs. terminal-error outcome types (must NOT).
export const FAILOVER_ELIGIBLE_OUTCOME_TYPES = new Set(['quota_error', 'rate_limit', 'service_unavailable', 'overloaded']);
export const TERMINAL_ERROR_OUTCOME_TYPES = new Set(['auth_error', 'bad_request']);

function scriptedOutcomeKey(providerId, modelId) {
  return `${providerId || 'unknown'}::${modelId || 'unknown'}`;
}

function readScriptFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeScriptFileSync(filePath, script) {
  writeFileSync(filePath, JSON.stringify(script), 'utf8');
}

function normalizeOutcome(candidate) {
  if (!candidate) return null;
  if (typeof candidate === 'string') return { type: candidate };
  if (typeof candidate === 'object' && candidate.type) return { ...candidate };
  return null;
}

/**
 * Consume (pop) the next scripted outcome queued for a (providerId, modelId)
 * pair, or fall back to the script's `default` outcome, or a plain success
 * when E2E_AGENT_SPAWN_SCRIPT_FILE is unset/absent/exhausted for that key.
 * @param {string|null} providerId
 * @param {string|null} modelId
 * @returns {{ type: string, message?: string, delayMs?: number, failDelayMs?: number }}
 */
export function consumeScriptedOutcome(providerId, modelId) {
  const filePath = process.env[SCRIPT_ENV_KEY];
  if (!filePath) return { ...DEFAULT_OUTCOME };

  const script = readScriptFile(filePath);
  const key = scriptedOutcomeKey(providerId, modelId);
  const queues = script.queues || {};
  const queue = queues[key];

  if (Array.isArray(queue) && queue.length > 0) {
    const [next, ...rest] = queue;
    queues[key] = rest;
    script.queues = queues;
    writeScriptFileSync(filePath, script);
    return normalizeOutcome(next) || { ...DEFAULT_OUTCOME };
  }

  return normalizeOutcome(script.default) || { ...DEFAULT_OUTCOME };
}
