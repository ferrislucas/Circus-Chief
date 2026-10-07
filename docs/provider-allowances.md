# Provider Allowance Sources

Provider allowance indicators ship to all users. They show only
authoritative provider data; when a source is unavailable or not yet
validated, its indicator is `unknown`. There is no feature flag or rollout
gate: every source below runs for eligible providers, so a source must be
validated against real payloads before it is merged.

## Source matrix

| Provider kind | Authentication mode | Acquisition mechanism | Source value |
| --- | --- | --- | --- |
| Anthropic / Claude Code | Claude OAuth subscription (Pro or Max) | Claude in-stream `rate_limit_event` frames | `claude-rate-limit-event` |
| OpenAI / Codex | ChatGPT OAuth subscription | Codex rollout tail: the session's local `rollout-*.jsonl` `token_count` frames | `codex-rollout` |
| OpenAI / Codex | ChatGPT OAuth subscription | Codex app-server: local JSON-RPC rate-limit meter | `codex-app-server` |
| Anthropic- or OpenAI-kind provider on a z.ai GLM Coding Plan host | API key | z.ai poll: provider quota endpoint, immediately then every five minutes | `zai-quota-poll` |
| OpenAI-compatible provider | API key | OpenAI headers: documented `x-ratelimit-limit-*`, `x-ratelimit-remaining-*`, and `x-ratelimit-reset-*` response headers | `observed-header` |

The OpenAI direct API adapter is a best-effort header observation path for
OpenAI-compatible API-key providers, not a supported production allowance
source. It retains no headers, request IDs, credentials, or response bodies;
only a normalized allowance candidate is emitted. Missing, malformed, or
unsupported headers leave the indicator `unknown` (or preserve the most recent
valid observation).

The Codex app-server meter re-resolves the built-in provider's auth context
on every (re)spawn and every account read, so rotating or disabling that
credential applies without a server restart: rotation takes effect on the
next respawn or refresh, and while no eligible provider remains the meter
stands down (logging `no-provider`) and rechecks on a bounded cadence
instead of spawning. Flag changes still require a server restart.

## Configuration

There are no opt-in flags: collection and presentation are always on. The
only tuning knob is freshness:

| Variable | Default | Effect |
| --- | --- | --- |
| `PROVIDER_ALLOWANCE_STREAM_STALE_MS` | `900000` (15 minutes) | Freshness duration for Claude in-stream and Codex rollout-tail observations. A finite non-negative value overrides the default. |

The Claude Code adapter consumes `rate_limit_event` frames from the SDK
stream and reads them into the allowance service unconditionally; the frame
is never forwarded to the conversation UI either way, so plan telemetry
cannot leak into conversation history.

## Codex rollout-tail discovery

The tail discovers its file in two stages. Until the CLI emits its session
id, the watcher follows a newest-file heuristic as a discovery fallback only:
observations decoded during this provisional window are held back, never
emitted against the session's provider, so a busy host with concurrent Codex
sessions cannot attribute one session's limits to another provider. Once the
session id arrives (`pin`), the held provisional data is discarded and the
watcher's own rollout file is located and re-read authoritatively.

On first discovery of a large existing rollout, only the trailing 256KB is
read (earlier history is skipped, including any partial leading line); all
later appends are consumed in full. A provider whose session ends before its
next turn therefore stays `unknown` until that turn appends new token-count
frames — unknown-until-next-turn is the honest state, not a gap.

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

Staleness is a freshness overlay, not a replacement status: an expired
snapshot keeps its underlying `status` (`warning`, `critical`, `exhausted`,
…) alongside a `stale: true` flag, so attention ordering, the mobile badge
count, and screen-reader announcements keep treating a stale-critical
provider as critical. The UI renders the stale marker ("Last value may be
out of date"), the last-updated time, and the muted treatment from the
flag.

## Validation before merge

1. Validate a new source against real payloads and freshness, with sanitized
   fixtures captured from those payloads checked in as tests.
2. Do not infer allowances from request logs, credentials, or unsupported
   provider APIs.
3. Merge a source only after its evidence and tests are recorded here.

### Claude in-stream capture status

On 2026-09-21, the planned live OAuth capture of Claude
`rate_limit_event` telemetry could not run because the local Claude Code OAuth
token was revoked (401). The checked-in Claude fixture remains derived from the
SDK type contract. A sanitized live capture is still pending to confirm the
real payload shape; its validation bar is a sanitized live capture plus green
mapper, adapter, and E2E cassette suites.
