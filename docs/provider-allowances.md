# Provider Allowance Sources

## OpenAI direct API adapter

The supported production source is the OpenAI direct API path in
`CodexAdapter`. It reads only the documented `x-ratelimit-limit-*`,
`x-ratelimit-remaining-*`, and `x-ratelimit-reset-*` response headers for
request and token limits. Reset duration headers (`h`, `m`, `s`, and `ms`) are
converted to epoch milliseconds at the adapter boundary.

The adapter emits a provider-neutral candidate for the session's configured
OpenAI provider ID. `ProviderAllowanceService` validates and normalizes it,
calculates `staleAt` from the first reset, stores it, and broadcasts the shared
`provider_allowance_updated` contract. Raw headers, request IDs, credentials,
and response bodies are never retained or broadcast.

OpenAI observations with incomplete, malformed, unsupported, disabled, or
unknown provider data are ignored. Those providers remain unknown (or retain a
previous valid snapshot); unsupported provider kinds display the existing
honest unknown state.
