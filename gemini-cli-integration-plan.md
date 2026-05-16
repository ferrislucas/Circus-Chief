# Plan: Google Gemini CLI Agent Support

Add `gemini-cli` as a third agent adapter alongside Claude Code and OpenAI Codex.

The Gemini CLI (`@google/gemini-cli`) supports non-interactive execution via `gemini -p "prompt" --output-format stream-json`, which emits newline-delimited JSON events (`init`, `message`, `tool_use`, `tool_result`, `result`). This maps cleanly onto the existing SDK-shaped event protocol that Circus Chief already uses.

---

## Phase 1: Shared Package Updates

### 1.1 Add `'google'` to `ProviderKind` enum
**File:** `packages/shared/src/contracts/providers.js`
- Change `ProviderKind = z.enum(['anthropic', 'openai'])` → `z.enum(['anthropic', 'openai', 'google'])`
- `TestConnectionRequest` already uses `ProviderKind` for its `kind` field, so it automatically accepts `'google'`

### 1.2 Add Gemini models constant
**File:** `packages/shared/src/types.js`
- Add `GEMINI_MODELS` array with seed entries. Each entry must include a `seedId` field (used by `seedBaselineData.js` to derive `BUILT_IN_GOOGLE_MODELS`):
  ```js
  export const GEMINI_MODELS = [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Most capable reasoning model', seedId: 'google-gemini-2-5-pro' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast & cost-efficient', seedId: 'google-gemini-2-5-flash' },
    { id: 'gemini-2.5-flash-lite-preview-06-17', name: 'Gemini 2.5 Flash Lite', description: 'Lightweight preview', seedId: 'google-gemini-2-5-flash-lite' },
  ];
  export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
  ```

---

## Phase 2: Database & Provider Layer

### 2.1 Update kind CHECK constraint
**File:** `packages/server/src/db/migrations/` (new migration in `providerMigrations.js`)
- The `providers` table has `CHECK(kind IN ('anthropic','openai'))` — add a migration to widen this to `CHECK(kind IN ('anthropic','openai','google'))`
- SQLite CHECK constraints are baked into the table definition and can't be altered in-place. The migration must recreate the table (same approach used by the existing `providerMigrations.js` table-recreate pattern):
  1. Create `providers_new` with the updated CHECK
  2. Copy data from `providers` → `providers_new`
  3. Drop `providers`
  4. Rename `providers_new` → `providers`
  5. Recreate indexes
- Also update the schema baseline in `packages/server/src/schema.sql` (line 46)

### 2.2 Update `PROVIDER_KINDS` and `AGENT_TYPE_BY_KIND`
**File:** `packages/server/src/db/ProviderRepository.js`
- Add `'google'` to the `PROVIDER_KINDS` frozen array (line 11): `['anthropic', 'openai', 'google']`
  - This is the application-layer validation in the `create()` method; without it, `create({ kind: 'google' })` throws "Invalid provider kind" before reaching the DB
- Add `google: 'gemini'` to `AGENT_TYPE_BY_KIND` (line 17):
  ```js
  export const AGENT_TYPE_BY_KIND = Object.freeze({
    anthropic: 'claude-code',
    openai: 'codex',
    google: 'gemini',
  });
  ```

### 2.3 Add built-in Google provider seed
**File:** `packages/server/src/db/seedBaselineData.js`
- Import `GEMINI_MODELS` from `@circuschief/shared`
- Add `BUILT_IN_GOOGLE_PROVIDER = { id: 'google-default', name: 'Google (Official)', kind: 'google' }`
- Add `BUILT_IN_GOOGLE_MODELS` derived from `GEMINI_MODELS` (same `.map()` pattern as `BUILT_IN_OPENAI_MODELS` on line 23):
  ```js
  export const BUILT_IN_GOOGLE_MODELS = GEMINI_MODELS.map((model) => ({
    id: model.seedId,
    providerId: BUILT_IN_GOOGLE_PROVIDER.id,
    modelId: model.id,
    displayName: model.name,
    description: model.description,
    tier: 'custom',
  }));
  ```
- In `seedBuiltInProviders()`:
  - Add a third `INSERT OR IGNORE INTO providers` for the Google provider
  - Add `...BUILT_IN_GOOGLE_MODELS` to the model loop (line 90)

### 2.4 Update `resolveAgentTypeFromModel()`
**File:** `packages/server/src/services/sessionProvider.js`
- Add `if (provider.kind === 'google') return 'gemini';` to the fallback branch (line 43) for test doubles that don't implement `getAgentTypeForProvider`

---

## Phase 3: Gemini CLI Adapter

### 3.1 Create `GeminiAdapter`
**File:** `packages/server/src/agents/adapters/GeminiAdapter.js`

Follow the CodexAdapter pattern — CLI-first:

```js
export class GeminiAdapter extends BaseAgent {
  static capabilities = Object.freeze({
    streaming: true,
    thinking: false,
    reasoningEffort: false,
    toolUse: true,
    resume: false,
  });

  constructor({ spawnGeminiProcess, ...rest } = {}) {
    super(rest);
    this._spawnGemini = spawnGeminiProcess;
  }

  getCapabilities() {
    return { ...GeminiAdapter.capabilities };
  }

  supportsResume() {
    return false;
  }

  async *execute(queryParams, _meta) {
    const options = queryParams.options || {};
    yield* this._executeCli(queryParams, options);
  }
}
```

**Capabilities:**
- `streaming: true` — stream-json provides real-time events
- `thinking: false` — no separate thinking mode toggle (Gemini handles it internally)
- `reasoningEffort: false` — no effort level mapping yet
- `toolUse: true` — Gemini CLI has built-in shell, file, and web tools
- `resume: false` — no session resume support in headless mode

The constructor accepts `spawnGeminiProcess` via DI (same pattern as CodexAdapter's `spawnCodexProcess`) so tests can inject a mock spawner.

### 3.2 Create `geminiEventMapper.js`
**File:** `packages/server/src/agents/adapters/geminiEventMapper.js`

Factory function returning `{ map, reset, finalize }` (same shape as `createCodexEventMapper`).

Map Gemini CLI `stream-json` events to SDK-shaped events:

| Gemini CLI Event | SDK Event |
|---|---|
| `{"type":"init", "session_id":..., "model":...}` | `{ type: 'system', subtype: 'init', session_id, model }` |
| `{"type":"message", "role":"user", ...}` | Ignored (echo of user prompt) |
| `{"type":"message", "role":"assistant", "delta":true, "content":"..."}` | `{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }` |
| `{"type":"message", "role":"assistant", "delta":false, "content":"..."}` | `{ type: 'assistant', message: { content: [{ type: 'text', text }] } }` |
| `{"type":"tool_use", "tool_name":..., "tool_id":..., "parameters":...}` | `{ type: 'tool_result', tool_name, content: JSON.stringify(parameters) }` (emit immediately as work log) |
| `{"type":"tool_result", "tool_id":..., "status":..., "output":...}` | `{ type: 'tool_result', tool_name: <matched from prior tool_use>, content: output }` |
| `{"type":"result", "status":"success", "stats":{...}}` | `{ type: 'result', subtype: 'success', usage: { input_tokens: stats.input_tokens, output_tokens: stats.output_tokens } }` |
| Unknown `type` | Warn once per type (same as codexEventMapper), return `[]` |

Stateful mapper class tracks:
- `lastUsage` — accumulated token usage from `result` event stats
- `terminated` — whether a terminal `result` event has been emitted
- `pendingToolUse` — map of `tool_id → tool_name` for matching `tool_result` back to its `tool_use`

`finalize()` emits a synthetic `result` event with zeroed usage if the stream ends without an explicit `result` event (e.g., process killed).

### 3.3 Create `geminiCliRunner.js`
**File:** `packages/server/src/agents/adapters/geminiCliRunner.js`

Follow the `codexCliRunner.js` pattern (reuse the same `CliState` + `drainCliEvents` structure):
- Compose a combined prompt string: if systemPrompt is present, prepend it as `"SYSTEM PROMPT:\n{systemPrompt}\n\nUSER:\n{prompt}"` (same `composeCliPrompt` pattern as Codex)
- Spawn `gemini` process with args: `-p`, `<composedPrompt>`, `--output-format`, `stream-json`, `-m`, `<model>`
- The prompt is passed as a `-p` CLI argument (NOT via stdin — unlike Codex, Gemini CLI takes prompts as a flag argument)
- Read JSONL from stdout via `readline`
- Parse each line, feed through `geminiEventMapper.map()`
- Attach stderr reader for error capture
- Handle `ENOENT` from spawn → set `geminiCliUnavailable` flag + throw `GEMINI_CLI_NOT_FOUND`
- Handle non-zero exit codes → throw with stderr content
- Drain events via async generator

### 3.4 Create `geminiSpawnHelper.js`
**File:** `packages/server/src/services/geminiSpawnHelper.js`

Same pattern as `codexSpawnHelper.js`:
- Uses `spawn()` with `stdio: ['pipe', 'pipe', 'pipe']`
- Replaces `'node'` with `process.execPath`
- Uses `createRobustEnv()` for PATH
- Hooks into E2E spawn capture via `isE2ESpawnCaptureEnabled()` / `captureSpawnAttempt('gemini', options)` / `createCapturedSpawnProcess('gemini')`

---

## Phase 4: Session Execution Wiring

### 4.1 Register adapter in `AgentGateway`
**File:** `packages/server/src/agents/AgentGateway.js`
- Import `GeminiAdapter` from `./adapters/GeminiAdapter.js`
- Add `this.registerAdapter('gemini', GeminiAdapter)` in `_registerDefaultAdapters()`

### 4.2 Update `buildAgentConfig()` in `sessionExecution.js`
**File:** `packages/server/src/services/sessionExecution.js`
- The `buildAgentConfig(agentType)` function (line 36) currently only branches on `'codex'`. Add a `'gemini'` branch:
  ```js
  function buildAgentConfig(agentType) {
    if (agentType === 'codex') {
      return { spawnCodexProcess: createCodexSpawner() };
    }
    if (agentType === 'gemini') {
      return { spawnGeminiProcess: createGeminiSpawner() };
    }
    return {};
  }
  ```
- Import `createGeminiSpawner` from `../services/geminiSpawnHelper.js`

### 4.3 Add `buildGeminiQueryParams()`
**File:** `packages/server/src/services/queryParamBuilder.js`
- Add new builder function for Gemini-specific params:
  ```js
  function buildGeminiQueryParams({
    prompt, workingDirectory, controller, session, sessionId, systemPrompt, model, sessionEnv,
  }) {
    const isVCR = Boolean(process.env.VCR_MODE);
    const effectiveModel = isVCR ? 'gemini-2.5-flash' : model;

    return {
      prompt,
      options: {
        cwd: workingDirectory,
        abortController: controller,
        env: sessionEnv,
        model: effectiveModel,
        systemPrompt: buildSystemPromptConfig(sessionId, session.projectId, systemPrompt, session.mode),
      },
    };
  }
  ```
- No `permissionMode`, `settingSources`, `resume`, `sandboxMode`, or `effortLevel`
- VCR mode uses `'gemini-2.5-flash'` as the cheap model override
- Update `buildQueryParams()` dispatcher:
  ```js
  export function buildQueryParams(options) {
    const { agentType = 'claude-code' } = options || {};
    if (agentType === 'codex') return buildCodexQueryParams(options);
    if (agentType === 'gemini') return buildGeminiQueryParams(options);
    return buildClaudeCodeQueryParams(options);
  }
  ```
- Update JSDoc on `buildQueryParams` (line 81): `@param {string} [options.agentType] - 'claude-code' (default) | 'codex' | 'gemini'`

### 4.4 Add Google provider env handling
**File:** `packages/server/src/services/sessionProvider.js`
- Add `buildGoogleProviderEnv(provider)`:
  ```js
  function buildGoogleProviderEnv(provider) {
    const env = {};
    if (provider.authToken) env.GEMINI_API_KEY = provider.authToken;
    return env;
  }
  ```
  - Additional vars like `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` are set via `provider.additionalEnvVars` (already applied generically in `buildProviderEnv`)
- Update `buildProviderEnv()` to branch on `kind === 'google'`:
  ```js
  const env = kind === 'openai'
    ? buildOpenAIProviderEnv(provider)
    : kind === 'google'
      ? buildGoogleProviderEnv(provider)
      : buildAnthropicProviderEnv(provider);
  ```
- Add `logGoogleProviderEnv()` for console logging (same pattern as existing `logProviderEnv`)
- Update `buildSessionEnv()`:
  - Add `kind === 'google'` branch alongside existing `kind === 'openai'`:
    ```js
    } else if (kind === 'google') {
      applyGoogleSessionEnv(sessionEnv, providerEnv);
    } else {
    ```
  - `applyGoogleSessionEnv` strips `ANTHROPIC_*` and `OPENAI_*` host env vars (defense-in-depth), does NOT set `MAX_THINKING_TOKENS` or `CLAUDE_CODE_EFFORT_LEVEL`
- Add `stripGoogleHostEnv(env)` — called from existing Anthropic and OpenAI flows to strip `GEMINI_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_GENAI_USE_VERTEXAI` from non-Google sessions

### 4.5 Update `sessionPrompts.js` (if needed)
**File:** `packages/server/src/services/sessionPrompts.js`
- No changes needed for Phase 1. The `buildSystemPromptConfig()` function is agent-agnostic — it composes the system prompt from canvas instructions, session API instructions, etc. and returns a string. Gemini's `buildGeminiQueryParams` already calls it.
- Gemini CLI sandbox support (`--sandbox` flag) deferred to a later phase.

---

## Phase 5: Frontend Updates

### 5.1 Update `ModelSelector.vue`
**File:** `packages/web/src/components/ModelSelector.vue`
- Update `agentTypeFor(provider)` (line 105):
  ```js
  function agentTypeFor(provider) {
    if (provider?.kind === 'openai') return 'codex';
    if (provider?.kind === 'google') return 'gemini';
    return 'claude-code';
  }
  ```
- Update `agentLabelFor(provider)` (line 111):
  ```js
  function agentLabelFor(provider) {
    const type = agentTypeFor(provider);
    if (type === 'codex') return 'Codex';
    if (type === 'gemini') return 'Gemini';
    return 'Claude Code';
  }
  ```
- Update `sortedProviders` comparator (line 121) — currently has binary logic (`claude-code` first, everything else second). Needs a sort-weight map for three agent types:
  ```js
  const AGENT_SORT_ORDER = { 'claude-code': 0, 'gemini': 1, 'codex': 2 };
  // In sort comparator:
  const aWeight = AGENT_SORT_ORDER[aType] ?? 99;
  const bWeight = AGENT_SORT_ORDER[bType] ?? 99;
  if (aWeight !== bWeight) return aWeight - bWeight;
  ```
- `defaultModel` (line 173) already filters to `claude-code` providers only and returns `null` for non-Anthropic — this is intentional and needs no change. Gemini has no "default" concept in the UI yet.

### 5.2 Update `useModelInfo.js` composable
**File:** `packages/web/src/composables/useModelInfo.js`
- Update `agentTypeForProvider()` (line 87):
  ```js
  function agentTypeForProvider(provider) {
    if (provider?.kind === 'openai') return 'codex';
    if (provider?.kind === 'google') return 'gemini';
    return 'claude-code';
  }
  ```
- Update `resolveCatalogModel()` (line 92) — add `kind === 'google'` branch:
  ```js
  function resolveCatalogModel(modelId, provider) {
    if (provider?.kind === 'openai') {
      return OPENAI_MODELS.find((m) => m.id === modelId) || null;
    }
    if (provider?.kind === 'google') {
      return GEMINI_MODELS.find((m) => m.id === modelId) || null;
    }
    if (!provider || agentTypeForProvider(provider) === 'claude-code') {
      return CLAUDE_MODELS.find((m) => m.id === modelId) || null;
    }
    return null;
  }
  ```
- Import `GEMINI_MODELS` from `@circuschief/shared` (line 1)
- Capabilities are automatically handled: `getModelInfo()` resolves `agentType` → `'gemini'` → looks up capabilities from the `/api/agents` cache, which will include Gemini capabilities once the adapter is registered in `AgentGateway`

### 5.3 Update `SessionFormOptions.vue`
**File:** `packages/web/src/components/SessionFormOptions.vue`
- No changes needed. The existing capability-driven logic handles Gemini automatically:
  - `supportsThinkingToggle` checks `capabilities?.thinking === true` → Gemini reports `thinking: false` → toggle disabled
  - `supportsReasoningEffort` checks `capabilities?.reasoningEffort === true` → Gemini reports `reasoningEffort: false` → selector disabled
  - `isCodexModel` is only used for agent-label display, not for disabling controls
- If Gemini-specific labeling is desired later (e.g., "Not supported by Gemini CLI"), a separate `isGeminiModel` computed can be added, but it's not needed for Phase 1

### 5.4 Update `ProviderForm.vue`
**File:** `packages/web/src/components/ProviderForm.vue`
- Add `'google'` option to the kind `<select>` (line 53-58):
  ```html
  <option value="anthropic">Anthropic (Claude Code)</option>
  <option value="openai">OpenAI / Codex</option>
  <option value="google">Google (Gemini CLI)</option>
  ```
- Update `baseUrlEnvName` computed (line 311):
  ```js
  const baseUrlEnvName = computed(() => {
    if (form.value.kind === 'openai') return 'OPENAI_BASE_URL';
    if (form.value.kind === 'google') return 'GEMINI_API_KEY';
    return 'ANTHROPIC_BASE_URL';
  });
  ```
  (Note: Gemini CLI doesn't use a base URL in the same way — the label should clarify this. But the env name hint for Google should show `GEMINI_API_KEY` only for the auth token field.)
- Update `authTokenEnvName` computed (line 314):
  ```js
  const authTokenEnvName = computed(() => {
    if (form.value.kind === 'openai') return 'OPENAI_API_KEY';
    if (form.value.kind === 'google') return 'GEMINI_API_KEY';
    return 'ANTHROPIC_AUTH_TOKEN';
  });
  ```
- Update `baseUrlPlaceholder` computed (line 317):
  ```js
  const baseUrlPlaceholder = computed(() => {
    if (form.value.kind === 'openai') return 'https://api.openai.com/v1';
    if (form.value.kind === 'google') return 'Leave blank for default Gemini endpoint';
    return 'https://bedrock-runtime.us-east-1.amazonaws.com';
  });
  ```

### 5.5 Update `ProvidersView.vue`
**File:** `packages/web/src/views/ProvidersView.vue`
- Update `getBuiltInProviderDescription()` (line 218):
  ```js
  function getBuiltInProviderDescription(provider) {
    if (provider.kind === 'openai') return 'Uses official OpenAI API';
    if (provider.kind === 'google') return 'Uses Google Gemini CLI';
    return 'Uses official Anthropic API';
  }
  ```

---

## Phase 6: Connection Testing

### 6.1 Add Google connection tester
**File:** `packages/server/src/services/providerTestService.js`
- Add `testGoogleConnection(config)` function:
  - Use the `@google/generative-ai` SDK (install as dependency) for a lightweight API test:
    ```js
    async function testGoogleConnection(config) {
      try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(config.authToken || '');
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent('Hi');
        return {
          success: true,
          message: 'Connection successful',
          details: { model: 'gemini-2.5-flash' },
        };
      } catch (error) {
        return failureResponse(error);
      }
    }
    ```
  - Alternative: spawn `gemini -p "Hi" --output-format json` and check exit code (avoids adding an SDK dependency but is slower and requires CLI installed)
- Update `testProviderConnection()` dispatcher (line 26):
  ```js
  export async function testProviderConnection(config) {
    const { kind = 'anthropic' } = config || {};
    if (kind === 'openai') return testOpenAIConnection(config);
    if (kind === 'google') return testGoogleConnection(config);
    return testAnthropicConnection(config);
  }
  ```

---

## Phase 7: Tests

### 7.1 Unit tests for `GeminiAdapter`
**File:** `packages/server/src/agents/adapters/GeminiAdapter.test.js`

| Test Case | Description |
|---|---|
| `static capabilities shape` | Assert `GeminiAdapter.capabilities` matches `{ streaming: true, thinking: false, reasoningEffort: false, toolUse: true, resume: false }` |
| `getCapabilities() returns a copy` | Assert `getCapabilities()` returns same values but is not the same frozen object reference |
| `supportsResume() returns false` | Assert falsy |
| `needsConversationContext() returns true` | Inherited from BaseAgent — verifies conversation history injection |
| `execute() spawns gemini process with correct args` | Mock spawner → verify called with `['-p', <prompt>, '--output-format', 'stream-json', '-m', <model>]` |
| `execute() yields system init event` | Mock process emits `init` JSONL → verify first yielded event is `{ type: 'system', subtype: 'init' }` |
| `execute() yields text delta then assistant on message` | Mock process emits assistant `message` → verify stream_event + assistant events |
| `execute() yields tool_result on tool events` | Mock process emits `tool_use` + `tool_result` → verify `tool_result` SDK events |
| `execute() yields result on stream end` | Mock process emits `result` → verify `{ type: 'result', subtype: 'success', usage }` |
| `execute() abort kills child process` | Trigger abort → verify `child.kill('SIGTERM')` called, fallback to `SIGKILL` after timeout |
| `execute() throws on ENOENT (CLI not found)` | Mock spawn ENOENT → verify `GEMINI_CLI_NOT_FOUND` error thrown |
| `execute() throws on non-zero exit code` | Mock process exit code 1 with stderr → verify error message includes stderr content |
| `execute() prepends system prompt to -p arg` | Verify composed prompt format: `"SYSTEM PROMPT:\n...\n\nUSER:\n..."` |

### 7.2 Unit tests for `geminiEventMapper`
**File:** `packages/server/src/agents/adapters/geminiEventMapper.test.js`

| Test Case | Description |
|---|---|
| `maps init → system(init) with session_id and model` | Input: `{ type: 'init', session_id: 'abc', model: 'gemini-2.5-flash' }` → Output: `[{ type: 'system', subtype: 'init', session_id: 'abc', model: 'gemini-2.5-flash' }]` |
| `uses constructor model when init event has no model` | Construct mapper with `{ model: 'gemini-2.5-pro' }`, feed `{ type: 'init', session_id: 'x' }` → verify `model: 'gemini-2.5-pro'` in output |
| `maps assistant message with delta:true → text_delta` | Input: `{ type: 'message', role: 'assistant', delta: true, content: 'hello' }` → Output: `[{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } } }]` |
| `maps assistant message with delta:false → assistant` | Input: `{ type: 'message', role: 'assistant', delta: false, content: 'hello' }` → Output: `[{ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }]` |
| `ignores user message events` | Input: `{ type: 'message', role: 'user', content: '...' }` → Output: `[]` |
| `maps tool_use event → tool_result with tool name and params` | Input: `{ type: 'tool_use', tool_name: 'Bash', tool_id: 't1', parameters: { command: 'ls' } }` → verify `tool_result` event emitted |
| `maps tool_result event → tool_result with matched tool name` | After `tool_use` with `tool_id: 't1', tool_name: 'Bash'`, feed `{ type: 'tool_result', tool_id: 't1', output: '...' }` → verify `tool_name: 'Bash'` in output |
| `maps result event → result(success) with token usage` | Input: `{ type: 'result', status: 'success', stats: { input_tokens: 100, output_tokens: 50 } }` → Output: `[{ type: 'result', subtype: 'success', usage: { input_tokens: 100, output_tokens: 50 } }]` |
| `result sets terminated flag (no duplicate)` | Map a `result` event, then call `finalize()` → verify `finalize()` returns `[]` |
| `finalize() emits synthetic result if stream ended without result` | Call `finalize()` without prior `result` event → verify `[{ type: 'result', subtype: 'success', usage: { input_tokens: 0, output_tokens: 0 } }]` |
| `warns once for unknown event types` | Map `{ type: 'unknown_event' }` twice → verify `console.warn` called once |
| `returns [] for null/non-object input` | `map(null)` and `map('string')` both return `[]` |
| `reset() clears state` | Map a result, call `reset()`, then `finalize()` → verify a new result event is emitted |

### 7.3 Unit tests for `geminiCliRunner`
**File:** `packages/server/src/agents/adapters/geminiCliRunner.test.js`

| Test Case | Description |
|---|---|
| `parses valid JSONL lines into events` | Feed multiple JSON lines to mock stdout → verify all lines parsed and yielded as events |
| `ignores empty lines` | Feed `\n\n` between valid lines → verify no errors, valid lines still parsed |
| `ignores malformed JSON lines` | Feed `{invalid json}` → verify line skipped, no error thrown |
| `stderr content included in error on non-zero exit` | Mock exit code 1 with stderr `"Error: foo"` → verify error message is `"Error: foo"` |
| `stderr without non-zero exit does not throw` | Mock exit code 0 with stderr warnings → verify no error |
| `ENOENT error marks CLI unavailable` | Mock spawn ENOENT error → verify `markCliUnavailable()` callback invoked and `GEMINI_CLI_NOT_FOUND` thrown |
| `finalize() called on clean exit` | Mock exit code 0 → verify `mapper.finalize()` events are yielded |
| `abort handler sends SIGTERM then SIGKILL` | Trigger abort → verify SIGTERM, wait 2s, verify SIGKILL |
| `prompt composed correctly with system prompt` | Verify the composed prompt passed to `-p` is `"SYSTEM PROMPT:\n...\n\nUSER:\n..."` |
| `prompt composed correctly without system prompt` | Verify bare user prompt passed to `-p` without prefix |

### 7.4 Integration tests
**File:** Updates to existing test files

| File | Test Case | Description |
|---|---|---|
| `AgentGateway.test.js` | `createAgent('gemini') returns GeminiAdapter` | Verify instance is `GeminiAdapter` |
| `AgentGateway.test.js` | `getAgentCapabilities('gemini') returns correct shape` | Verify `{ streaming: true, thinking: false, ... }` |
| `AgentGateway.test.js` | `getAvailableAgents() includes 'gemini'` | Verify `['claude-code', 'codex', 'gemini']` |
| `queryParamBuilder.test.js` | `buildQueryParams routes to Gemini builder` | Pass `agentType: 'gemini'` → verify no `permissionMode`, no `sandboxMode`, has `model` and `systemPrompt` |
| `queryParamBuilder.test.js` | `Gemini VCR model override` | Verify model is overridden to `'gemini-2.5-flash'` when `VCR_MODE=1` |
| `sessionProvider.test.js` | `buildSessionEnv for Google kind strips Anthropic+OpenAI vars` | Set `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in host env → verify stripped for `kind: 'google'` |
| `sessionProvider.test.js` | `buildSessionEnv for Google kind sets GEMINI_API_KEY` | Verify `provider.authToken` → `GEMINI_API_KEY` |
| `sessionProvider.test.js` | `buildSessionEnv for Google kind does NOT set MAX_THINKING_TOKENS` | Verify absent even when `thinkingEnabled: true` |
| `sessionProvider.test.js` | `resolveAgentTypeFromModel returns 'gemini' for Google model` | Register a Google-kind provider with a model → verify return value |
| `sessionProvider.test.js` | `buildSessionEnv for Anthropic kind strips GEMINI_* vars` | Verify `GEMINI_API_KEY` stripped from non-Google sessions |
| `sessionExecution.test.js` | `buildAgentConfig('gemini') returns spawnGeminiProcess` | Verify config key exists |

### 7.5 DB tests
**File:** Updates to existing test files

| File | Test Case | Description |
|---|---|---|
| `ProviderRepository.test.js` | `create with kind: 'google' succeeds` | Create provider, verify `kind === 'google'` |
| `ProviderRepository.test.js` | `getAgentTypeForProvider returns 'gemini' for google kind` | Create google provider → verify `getAgentTypeForProvider(id) === 'gemini'` |
| `ProviderRepository.test.js` | `getAgentTypeForProvider returns 'gemini' for built-in Google` | Verify `getAgentTypeForProvider('google-default') === 'gemini'` |
| `ProviderRepository.test.js` | `PROVIDER_KINDS includes 'google'` | Assert `PROVIDER_KINDS.includes('google')` |
| `SessionRepository.test.js` | `create with agentType: 'gemini' persists` | Create session → verify `agentType === 'gemini'` |
| `SessionRepository.test.js` | `agentType derived from google-kind model` | Create session with a Gemini model ID → verify `agentType === 'gemini'` |
| `schemaBaseline.test.js` | `providers kind CHECK allows 'google'` | Raw insert with `kind: 'google'` → verify no constraint violation |
| `seedBaselineData.test.js` | `seeds google-default provider` | Verify provider exists after seed with `kind: 'google'` |
| `seedBaselineData.test.js` | `seeds Gemini models` | Verify all `GEMINI_MODELS` entries exist as provider_models |

### 7.6 Frontend tests
**File:** Updates to existing test files

| File | Test Case | Description |
|---|---|---|
| `ModelSelector.test.js` | `groups Gemini models under "Gemini" label` | Provide google-kind provider → verify optgroup label contains `'Gemini'` |
| `ModelSelector.test.js` | `sorts Gemini between Claude Code and Codex` | Provide all three kinds → verify order: Claude Code, Gemini, Codex |
| `ModelSelector.test.js` | `agentTypeFor returns 'gemini' for google kind` | Verify mapping |
| `useModelInfo.test.js` | `agentTypeForProvider returns 'gemini' for google kind` | Verify mapping |
| `useModelInfo.test.js` | `resolveCatalogModel finds GEMINI_MODELS entries` | Verify `gemini-2.5-flash` resolves to catalog entry |
| `useModelInfo.test.js` | `getModelInfo returns agentType 'gemini' for Gemini model` | Verify full info object |
| `ProviderForm.test.js` | `shows Google option in kind select` | Verify `<option value="google">` exists |
| `ProviderForm.test.js` | `shows GEMINI_API_KEY hint when google selected` | Change kind to google → verify auth token label |
| `SessionFormOptions.test.js` | `disables thinking toggle for Gemini model` | Select gemini model → verify toggle disabled (via capability check) |

### 7.7 Connection test service tests
**File:** `packages/server/src/services/providerTestService.test.js`

| Test Case | Description |
|---|---|
| `testProviderConnection routes to Google tester for kind: 'google'` | Verify `testGoogleConnection` called |
| `testGoogleConnection returns success on valid API key` | Mock SDK → verify `{ success: true }` |
| `testGoogleConnection returns failure on invalid API key` | Mock SDK error → verify `{ success: false, message: 'Authentication failed...' }` |
| `testGoogleConnection returns failure on network error` | Mock ECONNREFUSED → verify appropriate message |

---

## Files Changed Summary

| File | Change |
|---|---|
| `packages/shared/src/contracts/providers.js` | Add `'google'` to `ProviderKind` enum |
| `packages/shared/src/types.js` | Add `GEMINI_MODELS` (with `seedId` fields), `DEFAULT_GEMINI_MODEL` |
| `packages/server/src/schema.sql` | Update kind CHECK to include `'google'` |
| `packages/server/src/db/migrations/providerMigrations.js` | New migration to widen kind CHECK constraint |
| `packages/server/src/db/ProviderRepository.js` | Add `'google'` to `PROVIDER_KINDS` array; add `google: 'gemini'` to `AGENT_TYPE_BY_KIND` |
| `packages/server/src/db/seedBaselineData.js` | Add Google provider + models seed |
| `packages/server/src/agents/AgentGateway.js` | Register `GeminiAdapter` |
| `packages/server/src/agents/adapters/GeminiAdapter.js` | **New** — main adapter class with `spawnGeminiProcess` DI |
| `packages/server/src/agents/adapters/geminiEventMapper.js` | **New** — JSONL event normalizer (factory function pattern) |
| `packages/server/src/agents/adapters/geminiCliRunner.js` | **New** — CLI process runner (prompt via `-p` flag) |
| `packages/server/src/services/geminiSpawnHelper.js` | **New** — spawn helper with E2E capture hook |
| `packages/server/src/services/sessionExecution.js` | Add `'gemini'` branch to `buildAgentConfig()` |
| `packages/server/src/services/queryParamBuilder.js` | Add `buildGeminiQueryParams()` with VCR override; update dispatcher |
| `packages/server/src/services/sessionProvider.js` | Add `buildGoogleProviderEnv()`, `applyGoogleSessionEnv()`, `stripGoogleHostEnv()`; update `resolveAgentTypeFromModel()` |
| `packages/server/src/services/providerTestService.js` | Add `testGoogleConnection()` function; update dispatcher |
| `packages/web/src/components/ModelSelector.vue` | Add `'gemini'` to `agentTypeFor`, `agentLabelFor`, and `sortedProviders` comparator |
| `packages/web/src/composables/useModelInfo.js` | Add `'gemini'` to `agentTypeForProvider()` and `resolveCatalogModel()` |
| `packages/web/src/components/ProviderForm.vue` | Add `'google'` option; update `baseUrlEnvName`, `authTokenEnvName`, `baseUrlPlaceholder` computeds |
| `packages/web/src/views/ProvidersView.vue` | Update `getBuiltInProviderDescription()` for google kind |

---

## Key Design Decisions

1. **New `kind: 'google'`** rather than reusing `'openai'` — Gemini uses different auth env vars (`GEMINI_API_KEY` vs `OPENAI_API_KEY`), different CLI (`gemini` vs `codex`), and different event formats.

2. **New `agentType: 'gemini'`** rather than reusing `'codex'` — although both are CLI-based, the event format, CLI flags, and runtime behavior differ enough to warrant a dedicated adapter.

3. **CLI-first approach** — mirrors the Codex pattern. The `gemini` CLI handles tool execution, sandboxing, and context management internally. A direct-API fallback can be added later.

4. **`stream-json` output format** — the Gemini CLI's `--output-format stream-json` provides JSONL events that map naturally to the SDK event protocol, making integration straightforward.

5. **Prompt via `-p` flag, not stdin** — unlike Codex CLI (which reads from stdin), Gemini CLI takes prompts as a `-p` command-line argument. System prompts are prepended to the `-p` value as text.

6. **No resume support initially** — Gemini CLI headless mode doesn't support session continuation. The `needsConversationContext()` method will return `true`, so the execution layer will inject conversation history into prompts.

7. **`SessionFormOptions` needs no changes** — the existing capability-driven architecture automatically disables unsupported controls (thinking toggle, effort selector) based on the server-reported capabilities from `GeminiAdapter.capabilities`.
