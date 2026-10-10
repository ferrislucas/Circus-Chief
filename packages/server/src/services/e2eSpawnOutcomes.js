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

// Canned failure messages, one per outcome type. Values are REAL provider
// error strings wherever one was harvested (agent_call_logs), so the E2E
// suites exercise the exact wording production delivers — synthetic wording
// once matched the pattern lists while real wording did not (incident
// ec5b56d5). Every value is pinned twice: against the detection matchers and
// against the sessionErrorFixtures.js corpus (see e2eSpawnOutcomes.test.js),
// so canned strings and the corpus can never drift apart.
export const OUTCOME_MESSAGES = {
  // Real OpenAI Codex usage-limit error (agent_call_logs, incident ec5b56d5).
  quota_error:
    "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 11:21 PM.",
  // Real OpenAI API 429 quota error (agent_call_logs, summary path).
  rate_limit:
    '429 You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.',
  // Anthropic-style 503 outage wording (no real 503 harvested yet — provider-doc style).
  service_unavailable: '503 Service Unavailable: the upstream service is temporarily unavailable',
  // Anthropic-style 529 overloaded wording (no real 529 harvested yet — provider-doc style).
  overloaded: '529 Overloaded: the API is temporarily overloaded, please retry',
  // Auth failure wording (pre-existing corpus; unchanged — already realistic).
  auth_error: '401 Unauthorized: invalid API key provided',
  // Real 400 invalid_request_error (agent_call_logs: Codex CLI calling a
  // Claude model via a ChatGPT account).
  bad_request:
    "The 'claude-sonnet-4-6' model is not supported when using Codex with a ChatGPT account.",
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
