# The OpenAI 404 Debugging Adventure

## The Problem

When creating a Codex (OpenAI) session in Circus Chief using any GPT-5.x model, the session fails with a 404 error:

```
API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: gpt-5.5"}}
```

This happened consistently across all model variants: `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.2-pro`, and `gpt-5.2`.

The Codex CLI was confirmed to work correctly when run directly from the terminal — only Circus Chief's spawned sessions failed.

---

## Theory 1: The model names don't exist ❌

**What I thought:** I checked OpenAI's public model list and concluded that model names like `gpt-5.5` and `gpt-5.4` weren't valid OpenAI model IDs.

**Why it was wrong:** The user tried `gpt-5.2` and `gpt-5.2-pro` — models that definitely exist — and got the same 404. Additionally, the Codex CLI's own `models_cache.json` file at `~/.codex/models_cache.json` listed all these models with `supported_in_api: true`, confirming they're valid Codex CLI model slugs.

**Lesson:** Don't trust public model listings for Codex CLI models. The CLI has its own model catalog that may differ from what's on OpenAI's website.

---

## Theory 2: Host environment's OPENAI_API_KEY overriding CLI auth ❌

**What I thought:** The host environment had `OPENAI_API_KEY` set, and Circus Chief's session env builder was passing it through to the Codex CLI child process. Since the Codex CLI checks for `OPENAI_API_KEY` env var before falling back to its own `~/.codex/auth.json` (ChatGPT Plus OAuth), the CLI would use the host's API key instead of its own auth.

**Why it was wrong:** The user pointed out that if auth were the issue, we'd see 401 (Unauthorized), not 404 (Not Found). A 404 means the request was authenticated successfully but the resource (model) wasn't found.

**Lesson:** Pay attention to HTTP status codes. They tell you what part of the request pipeline failed.

---

## Theory 3: Valid API key but no model access ❌

**What I thought:** The host environment's `OPENAI_API_KEY` was valid (authenticated successfully → hence 404, not 401) but the associated account didn't have access to GPT-5.x models.

**Why it was wrong:** The user had revoked all their API keys. There shouldn't be a valid key in the host environment.

**Lesson:** Trust the user's knowledge of their own environment.

---

## Direct CLI Testing — Confounding Results

I tested the Codex CLI directly from the terminal:

1. **Plain `codex exec`** — worked fine, used ChatGPT Plus auth
2. **With host's `OPENAI_API_KEY` explicitly passed** — still worked
3. **With a fake `OPENAI_API_KEY`** — still worked (!)

This was confusing because it suggested the CLI ignores `OPENAI_API_KEY` when it has ChatGPT Plus auth available. But Circus Chief sessions were failing...

**Lesson:** A tool's behavior can differ depending on the execution context. The CLI might have different code paths when run interactively vs. as a child process.

---

## The Smoking Gun: Codex CLI Internal Logs

I queried the Codex CLI's internal SQLite database at `~/.codex/logs_2.sqlite` and found:

- **Log entry 762**: `error.message=Quota exceeded. Check your plan and billing details.` with `auth_mode="ApiKey"` and `model=gpt-5.4`
- **Log entry 721**: Raw API error `{"type":"error","error":{"type":"insufficient_quota","code":"insufficient_quota",...}}`

This confirmed that when run through Circus Chief, the CLI WAS using the host environment's `OPENAI_API_KEY` (not ChatGPT Plus auth), and that key had insufficient quota. The `insufficient_quota` error from OpenAI's API was being mapped/surfaced as a 404 in the UI.

**The root cause was clear**: Circus Chief's `buildSessionEnv()` function in `sessionProvider.js` was leaking the host environment's `OPENAI_API_KEY` into the Codex CLI child process.

---

## The Fix

I created a plan and implemented a fix in `packages/server/src/services/sessionProvider.js`:

**Before** (the `kind === 'openai'` branch):
```javascript
} else if (kind === 'openai') {
    delete sessionEnv.ANTHROPIC_API_KEY;
    delete sessionEnv.ANTHROPIC_AUTH_TOKEN;
    delete sessionEnv.ANTHROPIC_BASE_URL;
    // BUG: OPENAI_API_KEY and OPENAI_BASE_URL from host env NOT stripped
    // when the provider has no authToken/baseUrl configured
}
```

**After**:
```javascript
} else if (kind === 'openai') {
    delete sessionEnv.ANTHROPIC_API_KEY;
    delete sessionEnv.ANTHROPIC_AUTH_TOKEN;
    delete sessionEnv.ANTHROPIC_BASE_URL;

    // The provider database is the single source of truth for auth.
    // If providerEnv didn't set these vars (via authToken, baseUrl, or
    // additionalEnvVars), strip any host-env bleedthrough so the CLI/SDK
    // falls back to its own auth (e.g. Codex CLI's ~/.codex/auth.json).
    if (!providerEnv.OPENAI_API_KEY) {
      delete sessionEnv.OPENAI_API_KEY;
    }
    if (!providerEnv.OPENAI_BASE_URL && !providerEnv.OPENAI_API_BASE) {
      delete sessionEnv.OPENAI_BASE_URL;
      delete sessionEnv.OPENAI_API_BASE;
    }
}
```

The key insight: check `providerEnv` (the computed result from `buildProviderEnv(provider)`) rather than checking `provider.authToken` directly. This correctly handles the case where a user sets `OPENAI_API_KEY` via `additionalEnvVars` — that intentional config must be preserved.

Tests were also added to `sessionProvider.test.js` covering:
1. OpenAI provider with no authToken — host `OPENAI_API_KEY` is stripped
2. OpenAI provider with authToken — provider token wins over host key
3. OpenAI provider with baseUrl — provider URL wins over host URL
4. `OPENAI_API_KEY` set via `additionalEnvVars` — preserved (critical edge case)
5. Host `OPENAI_API_BASE` (older alias) is also stripped

---

## The Plot Twist: The Error Persists ❌

After implementing the fix and running the tests (which passed), the user reported the same 404 error still occurring. The fix was correct in principle — it stopped the host environment's `OPENAI_API_KEY` from leaking — but the underlying 404 error remained.

**Possible explanations for why the fix didn't resolve it:**
1. The server wasn't restarted after the code change (Node.js doesn't hot-reload)
2. There's a separate code path that leaks the env var
3. The 404 error has a different root cause than the auth leak (the `insufficient_quota` → 404 mapping theory was wrong)
4. Something else in the environment is interfering

---

## Design Principle Established

Through this investigation, we established an important design principle that the fix correctly implements:

> **The provider's database config is the single source of truth for authentication.** The host environment's API keys should never bleed into session execution. If a provider doesn't configure an env var, it should be absent from the session env — allowing the underlying CLI/SDK to use its own authentication mechanism.

---

## Status: Unresolved

As of this writing, the 404 error with OpenAI models in Circus Chief remains unresolved. The auth leak fix is correct and valuable (it prevents a real bug), but it didn't fix the reported symptom. Further investigation is needed.

### Things to try next:
- Verify the server was restarted after the code change
- Add debug logging to `buildSessionEnv()` to confirm the env is clean when the session starts
- Check if the Codex CLI logs show `auth_mode="chatgpt"` after the fix (vs. the previous `"ApiKey"`)
- Test with `USE_CODEX_DIRECT_API=1` to see if the direct API path works (bypassing the CLI entirely)
- Examine whether the 404 is coming from the Codex CLI's own error handling rather than from OpenAI's API directly
- Check if there's a model routing issue (Codex CLI sends model names in a different format than what OpenAI expects)
