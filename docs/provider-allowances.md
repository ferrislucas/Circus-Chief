# Provider Allowance Sources

Provider allowance indicators are staged, opt-in telemetry. They show only
authoritative provider data; when a source is disabled, unavailable, or not
yet validated, its indicator is `unknown`. The feature is disabled by default.

## Source matrix

| Provider kind | Authentication mode | Acquisition mechanism | Source value |
| --- | --- | --- | --- |
| Anthropic / Claude Code | Claude OAuth subscription (Pro or Max) | Claude in-stream `rate_limit_event` frames | `claude-rate-limit-event` |
| OpenAI / Codex | ChatGPT OAuth subscription | Codex rollout tail: the session's local `rollout-*.jsonl` `token_count` frames | `codex-rollout` |
| OpenAI / Codex | ChatGPT OAuth subscription | Codex app-server: local JSON-RPC rate-limit meter | `codex-app-server` |
| Anthropic-compatible z.ai GLM Coding Plan | API key | z.ai poll: provider quota endpoint, immediately then every five minutes | `zai-quota-poll` |
| OpenAI-compatible provider | API key | OpenAI headers: documented `x-ratelimit-limit-*`, `x-ratelimit-remaining-*`, and `x-ratelimit-reset-*` response headers | `observed-header` |

The OpenAI direct API adapter is a best-effort header observation path for
OpenAI-compatible API-key providers, not a supported production allowance
source. It retains no headers, request IDs, credentials, or response bodies;
only a normalized allowance candidate is emitted. Missing, malformed, or
unsupported headers leave the indicator `unknown` (or preserve the most recent
valid observation).

## Rollout configuration

Every gate is default-off: only the literal value `1` opts in. Any other value,
including `true`, enables nothing. A source sub-flag is considered only after
the master gate is enabled. Remove a value or set it to any value other than
`1`, then restart the server, to roll it back.

| Variable | Default | Effect |
| --- | --- | --- |
| `PROVIDER_ALLOWANCES_ENABLED` | off | Master gate for collection and allowance UI presentation. |
| `PROVIDER_ALLOWANCES_CLAUDE` | off | Enables Claude in-stream allowance handling when the master gate is on. |
| `PROVIDER_ALLOWANCES_CODEX` | off | Enables the Codex rollout tail fallback when the master gate is on and the app-server meter is not healthy. |
| `PROVIDER_ALLOWANCES_CODEX_APPSERVER` | off | Enables the Codex app-server meter when the master gate is on. |
| `PROVIDER_ALLOWANCES_ZAI` | off | Enables the z.ai poller for eligible GLM Coding Plan providers when the master gate is on. |
| `PROVIDER_ALLOWANCE_STREAM_STALE_MS` | `900000` (15 minutes) | Freshness duration for Claude in-stream and Codex rollout-tail observations. A finite non-negative value overrides the default. |

For example, a controlled Codex rollout-tail validation needs both
`PROVIDER_ALLOWANCES_ENABLED=1` and `PROVIDER_ALLOWANCES_CODEX=1`. Enabling a
sub-flag alone has no effect.

## Freshness and failure policy

Claude in-stream and Codex rollout-tail observations become stale after
`PROVIDER_ALLOWANCE_STREAM_STALE_MS` (15 minutes by default) without a new
frame. Codex app-server observations carry the reset information reported by
the meter; OpenAI headers use their first advertised reset. z.ai is polled
immediately on startup and every five minutes thereafter; failed polls retain
the previous snapshot until its own freshness policy marks it stale. z.ai 401
or 403 responses stop polling that provider until its credential changes, and
429 responses honor `retry-after`.

All acquisition failures are non-critical: they do not interrupt an agent
session, and the UI stays honest by reporting stale or `unknown` data.

## Staged enablement

1. Keep `PROVIDER_ALLOWANCES_ENABLED` and every source sub-flag unset in
   normal deployments.
2. In a controlled environment, enable the master flag plus one source
   sub-flag, validate real payloads and freshness, then roll back if the
   source is not trustworthy.
3. Enable another source only after its own validation passes; do not infer
   allowances from request logs, credentials, or unsupported provider APIs.
4. Promote a source only after its evidence and tests are recorded here.

### Claude in-stream capture status

On 2026-09-21, the planned live OAuth capture of Claude
`rate_limit_event` telemetry could not run because the local Claude Code OAuth
token was revoked (401). The checked-in Claude fixture remains derived from the
SDK type contract, and the Claude source is shelved pending refreshed OAuth
access or an SDK bump. `PROVIDER_ALLOWANCES_CLAUDE` must remain default-off;
affected indicators stay `unknown` rather than presenting unverified allowance
data. Its validation gate is a sanitized live capture plus green mapper,
adapter, and E2E cassette suites.
