// ─────────────────────────────────────────────────────────────────────────
// sessionErrorFixtures.js — the pinned corpus of real provider error strings.
//
// DATA ONLY — no logic. Every row is one real-world provider error string
// together with the expected verdicts of the two detection policies in
// sessionErrors.js:
//
//   failoverEligible  — expected verdict of matchesStartFailoverEligibleError
//                       (the tight gate consulted by ALL tier-failover
//                       decisions). true ⇒ must fail over; false ⇒ must not.
//                       null ⇒ not applicable: the failover gate only ever
//                       sees error objects/events (message/type/code/reason),
//                       never assistant prose — prose rows are pinned on the
//                       completion path instead.
//
//   rescheduleTrigger — expected verdict of the broad auto-reschedule trigger
//                       pair used by checkRescheduleTrigger
//                       (matchesTokenLimitError OR matchesServiceError).
//                       true ⇒ weak-signal breadth must catch it; false ⇒ it
//                       must not. null ⇒ not applicable (prose rows — the
//                       completion path must classify them as "not a
//                       limit/outage hold" instead).
//
// The expected verdicts are the POLICY MATRIX below, keyed by family. The
// conformance suite (sessionErrors.conformance.test.js) asserts every row's
// verdicts against the exported matchers, pinning the deliberate precision
// differences between the two policies:
//   quota / service   — strong signals: fail over AND reschedule.
//   weak-signal       — reschedule yes (cheap retry), fail over NO (deliberate).
//   prompt-size       — reschedule yes, fail over NO (deliberate exclusion —
//                       failing over cannot fix an oversized prompt).
//   terminal          — neither (auth / bad-request / parse / abort).
//   prose-guard       — completion-path shape-guard rows; only the
//                       turnEndedDueToLimitOrOutage verdict is pinned.
// Rows needing an exception to the matrix pass an explicit override — those
// overrides are pinned asymmetries, each with its rationale in `source`.
//
// GROW THIS CORPUS, NOT THE PATTERN LISTS BLINDLY: every new provider error
// string observed in the wild (agent_call_logs is the usual source) becomes a
// row here. The original hole (incident ec5b56d5: a real OpenAI Codex
// usage-limit string matched the broad reschedule matcher's bare 'limit' but
// no tight failover pattern, so a tier-bound session rescheduled instead of
// failing over) is the first quota row below.
// ─────────────────────────────────────────────────────────────────────────

/** Family → expected [failoverEligible, rescheduleTrigger] verdicts. */
const POLICY_MATRIX = {
  quota: [true, true],
  service: [true, true],
  'weak-signal': [false, true],
  'prompt-size': [false, true],
  terminal: [false, false],
  'prose-guard': [null, null],
};

const SRC_INCIDENT =
  'agent_call_logs — incident ec5b56d5 (codex / gpt-5.6-terra, 2026-09-16): rescheduled instead of failing over';
const SRC_OPENAI_429 =
  'agent_call_logs — summary path, codex gpt-5.4-mini: real OpenAI API 429 quota error';
const SRC_CODEX_400 =
  'agent_call_logs — codex CLI calling a Claude model via a ChatGPT account: real 400 invalid_request_error';
const SRC_TESTS = 'sessionErrors.test.js';
const srcOutcome = (type, note) => `e2eSpawnOutcomes.js OUTCOME_MESSAGES.${type} — ${note}`;

/**
 * Row factory. `overrides` exists ONLY for rows whose pinned verdicts depart
 * from the family's policy matrix — each such row documents why in `source`.
 *
 * @param {string} message - Verbatim error text (matchers receive it
 *   lowercased, as the session path does).
 * @param {keyof typeof POLICY_MATRIX} kind
 * @param {string} source - Where the string came from.
 * @param {{ providerKind?: string|null, failoverEligible?: boolean|null, rescheduleTrigger?: boolean|null }} [overrides]
 */
const row = (message, kind, source, overrides = {}) => {
  const [failoverEligible, rescheduleTrigger] = POLICY_MATRIX[kind];
  return {
    // 'anthropic' | 'openai' | 'google' | null (null = provider-agnostic /
    // synthetic-but-shipped wording).
    providerKind: overrides.providerKind ?? null,
    source,
    message,
    kind,
    failoverEligible: overrides.failoverEligible ?? failoverEligible,
    rescheduleTrigger: overrides.rescheduleTrigger ?? rescheduleTrigger,
  };
};

// Family helpers keep the corpus readable (and keep long family names from
// being repeated past the duplication lint threshold).
const weakSignal = (message, source) => row(message, 'weak-signal', source);
const promptSize = (message, source) => row(message, 'prompt-size', source);
const proseGuard = (message, source) => row(message, 'prose-guard', source);

/**
 * @typedef {ReturnType<typeof row>} SessionErrorFixture
 */

/** @type {SessionErrorFixture[]} */
export const SESSION_ERROR_FIXTURES = [
  // ── Real strings harvested from agent_call_logs ─────────────────────────
  row(
    "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 11:21 PM.",
    'quota', SRC_INCIDENT, { providerKind: 'openai' }
  ),
  row(
    '429 You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.',
    'quota', SRC_OPENAI_429, { providerKind: 'openai' }
  ),
  row(
    `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'claude-sonnet-4-6' model is not supported when using Codex with a ChatGPT account."}}`,
    'terminal', `${SRC_CODEX_400} envelope`, { providerKind: 'anthropic' }
  ),
  row(
    "The 'claude-sonnet-4-6' model is not supported when using Codex with a ChatGPT account.",
    'terminal', `${SRC_CODEX_400} inner message`, { providerKind: 'anthropic' }
  ),

  // ── E2E canned messages (must never drift from this corpus — bound by
  //    e2eSpawnOutcomes.test.js) ───────────────────────────────────────────
  row(
    '503 Service Unavailable: the upstream service is temporarily unavailable',
    'service',
    srcOutcome('service_unavailable', 'provider-doc-style 503 outage wording (no real 503 harvested yet)'),
    { providerKind: 'anthropic' }
  ),
  row(
    '529 Overloaded: the API is temporarily overloaded, please retry',
    'service',
    srcOutcome('overloaded', 'provider-doc-style 529 overloaded wording (no real 529 harvested yet)'),
    { providerKind: 'anthropic' }
  ),
  row('401 Unauthorized: invalid API key provided', 'terminal', srcOutcome('auth_error', 'auth failure wording')),

  // ── Provider-doc-style wording (pre-existing test corpus) ───────────────
  row('Error: 529 Service overloaded', 'service', `${SRC_TESTS} — Anthropic-style 529 overloaded error`, { providerKind: 'anthropic' }),
  row('Error: 503 Service Unavailable', 'service', `${SRC_TESTS} — 503 service outage`, { providerKind: 'anthropic' }),
  row('too many requests — rate limit exceeded', 'service', `${SRC_TESTS} — combined throttling wording`),
  row('service unavailable right now', 'service', `${SRC_TESTS} — service outage prose`),
  row('quota exhausted for this billing period', 'quota', `${SRC_TESTS} — quota exhaustion phrasing`),
  row('out of tokens for this account', 'quota', `${SRC_TESTS} — token exhaustion phrasing`),
  row('insufficient credit balance', 'quota', [
    `${SRC_TESTS} — credit/billing phrasing (PRD F16 "insufficient credit balance").`,
    'Pinned asymmetry: the failover policy is deliberately broader than the broad',
    'reschedule pair for explicit credit/quota phrasing — the tight gate matches',
    "('insufficient credit') while matchesTokenLimitError / matchesServiceError do",
    'not (no weak keyword). Broad-reschedule vocabulary is intentionally untouched',
    "(invariant: preserve today's reschedule semantics), so a non-tier session",
    'terminal-errors here while a tier session fails over. Do NOT "fix" by adding',
    "'credit' to the broad list without a deliberate decision.",
  ].join(' '), { failoverEligible: true, rescheduleTrigger: false }),
  row('billing limit reached', 'quota', `${SRC_TESTS} — billing-limit phrasing (PRD F16 "spending/billing limit reached")`),
  row('billing hard limit reached', 'quota', `${SRC_TESTS} — hard billing-limit phrasing`),
  row('rate limit reached', 'service', `${SRC_TESTS} — plain rate-limit phrasing`),

  // ── Terminal errors: never fail over, never reschedule ──────────────────
  row('Invalid API key', 'terminal', `${SRC_TESTS} — auth failure`, { providerKind: 'anthropic' }),
  row('authentication failed', 'terminal', `${SRC_TESTS} — auth failure prose`),
  row('Unexpected token in JSON', 'terminal', [
    `${SRC_TESTS} — JSON parse error containing "token" (the canonical too-broad-for-failover case).`,
    "Contains the weak signal 'token', so the broad reschedule pair matches — a",
    'false-positive reschedule, which is the documented, accepted stance for the',
    'auto-reschedule policy ("prefer false-positive reschedules"). The failover',
    'gate must stay false: a JSON parse error is not a capacity error and must',
    'never switch providers.',
  ].join(' '), { rescheduleTrigger: true }),
  row('file not found: /foo/bar', 'terminal', `${SRC_TESTS} — filesystem error`),
  row('Command failed with exit code 1', 'terminal', `${SRC_TESTS} — process exit error`),
  row('ECONNREFUSED', 'terminal', `${SRC_TESTS} — network refusal (not a capacity error)`),
  row('permission denied', 'terminal', `${SRC_TESTS} — permission error`),

  // ── Weak signals: reschedule yes, fail over NO (deliberate precision
  //    difference between the two policies — pinned explicitly) ────────────
  weakSignal('limit', `${SRC_TESTS} — bare weak signal (matchesTokenLimitError only)`),
  weakSignal('token', `${SRC_TESTS} — bare weak signal (matchesTokenLimitError only)`),
  weakSignal('cap', `${SRC_TESTS} — bare weak signal (matchesTokenLimitError only)`),
  weakSignal('exceeded', `${SRC_TESTS} — bare weak signal (matchesTokenLimitError only)`),
  weakSignal("you've hit your limit", `${SRC_TESTS} — weak "limit" phrasing: reschedules but must NOT cross providers`),
  weakSignal('usage cap reached', `${SRC_TESTS} — weak "cap" phrasing: reschedules but must NOT cross providers`),
  weakSignal('usage exceeded for this period', `${SRC_TESTS} — weak "exceeded" phrasing: reschedules but must NOT cross providers`),

  // ── Prompt-size errors: reschedule yes, fail over NO (deliberate
  //    exclusion — see matchesStartFailoverEligibleError doc) ──────────────
  promptSize('context length exceeded', `${SRC_TESTS} — prompt-size (context length)`),
  promptSize('max_tokens parameter exceeded', `${SRC_TESTS} — prompt-size (max_tokens)`),
  promptSize('context window is full', `${SRC_TESTS} — prompt-size (context window)`),

  // ── Prose-guard rows: assistant-authored completion prose that happens to
  //    mention limit/outage vocabulary. The failover gate structurally never
  //    sees prose (it only sees error objects/events), and the completion
  //    path must classify these as NOT a limit/outage hold. Only the
  //    completion-path verdict is pinned. ──────────────────────────────────
  proseGuard('increased the pagination limit to 100', `${SRC_TESTS} — completion prose mentioning "limit"`),
  proseGuard('implemented a token bucket rate limiter', `${SRC_TESTS} — completion prose mentioning a "rate limiter"`),
  proseGuard('Fixed HTTP 503 Service Unavailable handling in the proxy', `${SRC_TESTS} — completion prose mentioning "503 Service Unavailable"`),
  proseGuard('Configured the rate limit at 100 rps', `${SRC_TESTS} — completion prose mentioning "rate limit"`),
  proseGuard('The API now returns 429 Too Many Requests when throttled', `${SRC_TESTS} — completion prose mentioning "too many requests"`),
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
