// ─────────────────────────────────────────────────────────────────────────
// sessionErrorFixtures.js — the pinned corpus of real provider error strings.
//
// DATA ONLY — no logic. Every row is one real-world provider error string
// together with the expected verdicts of the two detection policies in
// sessionErrors.js:
//
//   failoverEligible  — expected verdict of matchesStartFailoverEligibleError
//                       (the tight gate consulted by ALL tier-failover
//                       decisions). true ⇒ the string must fail over; false ⇒
//                       it must not. null ⇒ not applicable: the failover gate
//                       only ever sees error objects/events (message / type /
//                       code / reason), never assistant prose, so prose rows
//                       are pinned on the completion path instead.
//
//   rescheduleTrigger — expected verdict of the broad auto-reschedule trigger
//                       pair used by checkRescheduleTrigger
//                       (matchesTokenLimitError OR matchesServiceError).
//                       true ⇒ weak-signal breadth must catch it; false ⇒ it
//                       must not reschedule. null ⇒ not applicable (prose
//                       rows — the completion path must classify them as
//                       "not a limit/outage hold" instead).
//
// `kind` labels the row family so the conformance suite
// (sessionErrors.conformance.test.js) can pin the deliberate precision
// differences between the policies:
//   quota / service   — strong signals: fail over AND reschedule.
//   weak-signal       — reschedule yes (cheap retry), fail over NO (deliberate).
//   prompt-size       — reschedule yes, fail over NO (deliberate exclusion —
//                       failing over cannot fix an oversized prompt).
//   terminal          — neither (auth / bad-request / parse / abort).
//   prose-guard       — completion-path shape-guard rows; only the
//                       turnEndedDueToLimitOrOutage verdict is pinned.
//
// GROW THIS CORPUS, NOT THE PATTERN LISTS BLINDLY: every new provider error
// string observed in the wild (agent_call_logs is the usual source) becomes a
// row here. The conformance suite asserts each row's expected verdicts against
// the exported matchers, so the two policies can never again disagree about a
// known real string — this is the widened FR-4 invariant, now covering the
// failover gate. The original hole (incident ec5b56d5: a real OpenAI Codex
// usage-limit string matched the broad reschedule matcher's bare 'limit' but
// no tight failover pattern, so a tier-bound session rescheduled instead of
// failing over) is row #1.
// ─────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SessionErrorFixture
 * @property {string|null} providerKind - 'anthropic' | 'openai' | 'google' |
 *   or null when the wording is provider-agnostic / synthetic-but-shipped.
 * @property {string} source - Where the string came from (agent_call_logs,
 *   a provider doc/error format, or the pre-existing test corpus).
 * @property {string} message - The verbatim error text (any case; matchers
 *   receive it lowercased, as the session path does).
 * @property {'quota'|'service'|'weak-signal'|'prompt-size'|'terminal'|'prose-guard'} kind
 * @property {boolean|null} failoverEligible
 * @property {boolean|null} rescheduleTrigger
 */

/** @type {SessionErrorFixture[]} */
export const SESSION_ERROR_FIXTURES = [
  // ── Real strings harvested from agent_call_logs ─────────────────────────
  {
    providerKind: 'openai',
    source: 'agent_call_logs — incident ec5b56d5 (codex / gpt-5.6-terra, 2026-09-16): rescheduled instead of failing over',
    message:
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 11:21 PM.",
    kind: 'quota',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: 'openai',
    source: 'agent_call_logs — summary path, codex gpt-5.4-mini: real OpenAI API 429 quota error',
    message:
      '429 You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.',
    kind: 'quota',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: 'anthropic',
    source: 'agent_call_logs — codex CLI calling a Claude model via a ChatGPT account: real 400 invalid_request_error envelope',
    message:
      `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'claude-sonnet-4-6' model is not supported when using Codex with a ChatGPT account."}}`,
    kind: 'terminal',
    failoverEligible: false,
    rescheduleTrigger: false,
  },
  {
    providerKind: 'anthropic',
    source: 'agent_call_logs — codex CLI calling a Claude model via a ChatGPT account: inner message of the same 400',
    message:
      "The 'claude-sonnet-4-6' model is not supported when using Codex with a ChatGPT account.",
    kind: 'terminal',
    failoverEligible: false,
    rescheduleTrigger: false,
  },

  // ── Provider-doc-style wording (pre-existing test corpus) ───────────────
  {
    providerKind: 'anthropic',
    source: 'e2eSpawnOutcomes.js OUTCOME_MESSAGES.service_unavailable — provider-doc-style 503 outage wording (no real 503 harvested yet)',
    message: '503 Service Unavailable: the upstream service is temporarily unavailable',
    kind: 'service',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: 'anthropic',
    source: 'e2eSpawnOutcomes.js OUTCOME_MESSAGES.overloaded — provider-doc-style 529 overloaded wording (no real 529 harvested yet)',
    message: '529 Overloaded: the API is temporarily overloaded, please retry',
    kind: 'service',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'e2eSpawnOutcomes.js OUTCOME_MESSAGES.auth_error — auth failure wording',
    message: '401 Unauthorized: invalid API key provided',
    kind: 'terminal',
    failoverEligible: false,
    rescheduleTrigger: false,
  },
  {
    providerKind: 'anthropic',
    source: 'sessionErrors.test.js — Anthropic-style 529 overloaded error',
    message: 'Error: 529 Service overloaded',
    kind: 'service',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: 'anthropic',
    source: 'sessionErrors.test.js — 503 service outage',
    message: 'Error: 503 Service Unavailable',
    kind: 'service',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — combined throttling wording',
    message: 'too many requests — rate limit exceeded',
    kind: 'service',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — service outage prose',
    message: 'service unavailable right now',
    kind: 'service',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — quota exhaustion phrasing',
    message: 'quota exhausted for this billing period',
    kind: 'quota',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — token exhaustion phrasing',
    message: 'out of tokens for this account',
    kind: 'quota',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — credit/billing phrasing (PRD F16 "insufficient credit balance")',
    message: 'insufficient credit balance',
    kind: 'quota',
    // Pinned asymmetry: the failover policy is deliberately broader than the
    // broad reschedule pair for explicit credit/quota phrasing — the tight
    // gate matches ('insufficient credit') while matchesTokenLimitError /
    // matchesServiceError do not (no weak keyword). Broad-reschedule
    // vocabulary is intentionally untouched (invariant: preserve today's
    // reschedule semantics), so a non-tier session terminal-errors here while
    // a tier session fails over. Do NOT "fix" by adding 'credit' to the broad
    // list without a deliberate decision.
    failoverEligible: true,
    rescheduleTrigger: false,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — billing-limit phrasing (PRD F16 "spending/billing limit reached")',
    message: 'billing limit reached',
    kind: 'quota',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — hard billing-limit phrasing',
    message: 'billing hard limit reached',
    kind: 'quota',
    failoverEligible: true,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — plain rate-limit phrasing',
    message: 'rate limit reached',
    kind: 'service',
    failoverEligible: true,
    rescheduleTrigger: true,
  },

  // ── Terminal errors: never fail over, never reschedule ──────────────────
  {
    providerKind: 'anthropic',
    source: 'sessionErrors.test.js — auth failure',
    message: 'Invalid API key',
    kind: 'terminal',
    failoverEligible: false,
    rescheduleTrigger: false,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — auth failure prose',
    message: 'authentication failed',
    kind: 'terminal',
    failoverEligible: false,
    rescheduleTrigger: false,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — JSON parse error containing "token" (the canonical too-broad-for-failover case)',
    message: 'Unexpected token in JSON',
    kind: 'terminal',
    failoverEligible: false,
    // Contains the weak signal 'token', so the broad reschedule pair matches
    // — a false-positive reschedule, which is the documented, accepted stance
    // for the auto-reschedule policy ("prefer false-positive reschedules").
    // The failover gate must stay false: a JSON parse error is not a capacity
    // error and must never switch providers.
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — filesystem error',
    message: 'file not found: /foo/bar',
    kind: 'terminal',
    failoverEligible: false,
    rescheduleTrigger: false,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — process exit error',
    message: 'Command failed with exit code 1',
    kind: 'terminal',
    failoverEligible: false,
    rescheduleTrigger: false,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — network refusal (not a capacity error)',
    message: 'ECONNREFUSED',
    kind: 'terminal',
    failoverEligible: false,
    rescheduleTrigger: false,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — permission error',
    message: 'permission denied',
    kind: 'terminal',
    failoverEligible: false,
    rescheduleTrigger: false,
  },

  // ── Weak signals: reschedule yes, fail over NO (deliberate precision
  //    difference between the two policies — pinned explicitly) ────────────
  {
    providerKind: null,
    source: 'sessionErrors.test.js — bare weak signal (matchesTokenLimitError only)',
    message: 'limit',
    kind: 'weak-signal',
    failoverEligible: false,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — bare weak signal (matchesTokenLimitError only)',
    message: 'token',
    kind: 'weak-signal',
    failoverEligible: false,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — bare weak signal (matchesTokenLimitError only)',
    message: 'cap',
    kind: 'weak-signal',
    failoverEligible: false,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — bare weak signal (matchesTokenLimitError only)',
    message: 'exceeded',
    kind: 'weak-signal',
    failoverEligible: false,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — weak "limit" phrasing: reschedules but must NOT cross providers',
    message: "you've hit your limit",
    kind: 'weak-signal',
    failoverEligible: false,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — weak "cap" phrasing: reschedules but must NOT cross providers',
    message: 'usage cap reached',
    kind: 'weak-signal',
    failoverEligible: false,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — weak "exceeded" phrasing: reschedules but must NOT cross providers',
    message: 'usage exceeded for this period',
    kind: 'weak-signal',
    failoverEligible: false,
    rescheduleTrigger: true,
  },

  // ── Prompt-size errors: reschedule yes, fail over NO (deliberate
  //    exclusion — see matchesStartFailoverEligibleError doc) ──────────────
  {
    providerKind: null,
    source: 'sessionErrors.test.js — prompt-size (context length)',
    message: 'context length exceeded',
    kind: 'prompt-size',
    failoverEligible: false,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — prompt-size (max_tokens)',
    message: 'max_tokens parameter exceeded',
    kind: 'prompt-size',
    failoverEligible: false,
    rescheduleTrigger: true,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — prompt-size (context window)',
    message: 'context window is full',
    kind: 'prompt-size',
    failoverEligible: false,
    rescheduleTrigger: true,
  },

  // ── Prose-guard rows: assistant-authored completion prose that happens to
  //    mention limit/outage vocabulary. The failover gate structurally never
  //    sees prose (it only sees error objects/events), and the completion
  //    path must classify these as NOT a limit/outage hold. Only the
  //    completion-path verdict is pinned. ──────────────────────────────────
  {
    providerKind: null,
    source: 'sessionErrors.test.js — completion prose mentioning "limit"',
    message: 'increased the pagination limit to 100',
    kind: 'prose-guard',
    failoverEligible: null,
    rescheduleTrigger: null,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — completion prose mentioning a "rate limiter"',
    message: 'implemented a token bucket rate limiter',
    kind: 'prose-guard',
    failoverEligible: null,
    rescheduleTrigger: null,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — completion prose mentioning "503 Service Unavailable"',
    message: 'Fixed HTTP 503 Service Unavailable handling in the proxy',
    kind: 'prose-guard',
    failoverEligible: null,
    rescheduleTrigger: null,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — completion prose mentioning "rate limit"',
    message: 'Configured the rate limit at 100 rps',
    kind: 'prose-guard',
    failoverEligible: null,
    rescheduleTrigger: null,
  },
  {
    providerKind: null,
    source: 'sessionErrors.test.js — completion prose mentioning "too many requests"',
    message: 'The API now returns 429 Too Many Requests when throttled',
    kind: 'prose-guard',
    failoverEligible: null,
    rescheduleTrigger: null,
  },
];

/**
 * Look up the fixture row for an exact message, if one exists. Used by the
 * E2E outcome bindings test to prove canned and corpus can never drift apart.
 * @param {string} message
 * @returns {SessionErrorFixture|undefined}
 */
export function findFixtureByMessage(message) {
  return SESSION_ERROR_FIXTURES.find((fixture) => fixture.message === message);
}
