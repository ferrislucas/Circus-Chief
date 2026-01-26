# Custom Model Providers Implementation Plan

## Overview

This feature allows users to configure custom model providers (beyond Anthropic's official API) so they can use Claude through alternative endpoints like AWS Bedrock, Google Vertex AI, or self-hosted proxies.

## User Requirements

Users need to configure:
- **Provider Name** - Human-readable label (e.g., "AWS Bedrock", "My Proxy")
- **Base URL** - `ANTHROPIC_BASE_URL` for the alternative endpoint
- **Auth Token** - `ANTHROPIC_AUTH_TOKEN` for authentication
- **Model Mappings** - Custom model IDs for:
  - `ANTHROPIC_DEFAULT_OPUS_MODEL`
  - `ANTHROPIC_DEFAULT_SONNET_MODEL`
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- **Timeout** - `API_TIMEOUT_MS` for longer timeouts
- **Additional ENV vars** - Flexible key-value pairs for other settings

## Architecture Decisions

### Scope: Global Providers ✓

**Decision: Global-only providers**

- Providers are configured globally (once per claudetools installation)
- Projects select which provider to use (or default to Anthropic)
- Sessions inherit from project but can override

This keeps configuration simple and avoids duplication.

### Connection Testing ✓

**Decision: Include provider connection testing**

- Users can test a provider configuration before saving
- Validates connectivity, authentication, and model availability
- Provides clear error messages for troubleshooting

---

## Implementation Phases

### Phase 1: Database Schema

#### New Table: `model_providers`

```sql
CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                     -- Display name
  baseUrl TEXT,                           -- ANTHROPIC_BASE_URL
  authToken TEXT,                         -- ANTHROPIC_AUTH_TOKEN (encrypted)
  defaultOpusModel TEXT,                  -- ANTHROPIC_DEFAULT_OPUS_MODEL
  defaultSonnetModel TEXT,                -- ANTHROPIC_DEFAULT_SONNET_MODEL
  defaultHaikuModel TEXT,                 -- ANTHROPIC_DEFAULT_HAIKU_MODEL
  apiTimeoutMs INTEGER,                   -- API_TIMEOUT_MS
  additionalEnvVars TEXT,                 -- JSON object for extra env vars
  isDefault INTEGER DEFAULT 0,            -- Is this the default provider?
  isBuiltIn INTEGER DEFAULT 0,            -- Is this the Anthropic default?
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick default lookup
CREATE INDEX IF NOT EXISTS idx_model_providers_default ON model_providers(isDefault);
```

#### New Table: `provider_models`

Custom models per provider that users can select:

```sql
CREATE TABLE IF NOT EXISTS provider_models (
  id TEXT PRIMARY KEY,
  providerId TEXT NOT NULL,
  modelId TEXT NOT NULL,                  -- Actual model ID passed to API
  displayName TEXT NOT NULL,              -- Human-readable name
  description TEXT,                       -- Optional description
  tier TEXT CHECK(tier IN ('opus', 'sonnet', 'haiku', 'custom')),
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (providerId) REFERENCES model_providers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(providerId);
```

#### Schema Updates

Add provider reference to existing tables:

```sql
-- Add to project_session_defaults
ALTER TABLE project_session_defaults ADD COLUMN providerId TEXT;

-- Add to sessions
ALTER TABLE sessions ADD COLUMN providerId TEXT;

-- Add to conversations (for tracking)
ALTER TABLE conversations ADD COLUMN providerId TEXT;
```

**Files to modify:**
- `packages/server/src/schema.sql` - Add new tables
- `packages/server/src/db/DatabaseManager.js` - Add migration logic

---

### Phase 2: Backend - Repository & Service Layer

#### New File: `packages/server/src/db/ModelProviderRepository.js`

```javascript
// CRUD operations for model_providers table
class ModelProviderRepository extends BaseRepository {
  constructor(db) {
    super(db, 'model_providers');
  }

  // Create provider with validation
  create(provider) { ... }

  // Get all providers (including built-in Anthropic)
  getAll() { ... }

  // Get provider by ID
  getById(id) { ... }

  // Set default provider
  setDefault(providerId) { ... }

  // Get default provider
  getDefault() { ... }

  // Update provider
  update(id, updates) { ... }

  // Delete provider (prevent deletion of built-in)
  delete(id) { ... }

  // Get models for a provider
  getModels(providerId) { ... }

  // Add custom model to provider
  addModel(providerId, model) { ... }

  // Remove custom model
  removeModel(modelId) { ... }
}
```

#### Modify: `packages/server/src/services/sessionManager.js`

Update `runSession()` and `continueSession()` to:

1. Resolve provider from session → project → default
2. Build environment variables from provider config
3. Pass to Claude SDK via `env` option

```javascript
// In runSession() - add provider resolution
const provider = await resolveProvider(session, project);
const providerEnv = buildProviderEnv(provider);

const sessionEnv = {
  ...providerEnv,  // Add provider env vars first
  ...(thinkingEnabled ? { MAX_THINKING_TOKENS: '10240' } : {})
};
```

#### New Helper: `buildProviderEnv(provider)`

```javascript
function buildProviderEnv(provider) {
  if (!provider || provider.isBuiltIn) {
    return {}; // Use SDK defaults
  }

  const env = {};

  if (provider.baseUrl) {
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
  }
  if (provider.authToken) {
    env.ANTHROPIC_AUTH_TOKEN = provider.authToken;
  }
  if (provider.defaultOpusModel) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = provider.defaultOpusModel;
  }
  if (provider.defaultSonnetModel) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = provider.defaultSonnetModel;
  }
  if (provider.defaultHaikuModel) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.defaultHaikuModel;
  }
  if (provider.apiTimeoutMs) {
    env.API_TIMEOUT_MS = String(provider.apiTimeoutMs);
  }

  // Parse additional env vars
  if (provider.additionalEnvVars) {
    const extras = JSON.parse(provider.additionalEnvVars);
    Object.assign(env, extras);
  }

  return env;
}
```

---

### Phase 3: Backend - API Endpoints

#### New File: `packages/server/src/api/providers.js`

```javascript
// GET /api/providers - List all providers
// POST /api/providers - Create new provider
// GET /api/providers/:id - Get provider details
// PATCH /api/providers/:id - Update provider
// DELETE /api/providers/:id - Delete provider
// POST /api/providers/:id/default - Set as default

// Connection testing
// POST /api/providers/test - Test provider configuration (before saving)
// POST /api/providers/:id/test - Test existing provider connection

// Provider models
// GET /api/providers/:id/models - List models for provider
// POST /api/providers/:id/models - Add model to provider
// DELETE /api/providers/:id/models/:modelId - Remove model
```

#### New File: `packages/server/src/services/providerTestService.js`

Service for testing provider connections:

```javascript
import Anthropic from '@anthropic-ai/sdk';

/**
 * Test a provider configuration by making a minimal API call
 * @param {Object} config - Provider configuration to test
 * @returns {Promise<{success: boolean, message: string, details?: Object}>}
 */
export async function testProviderConnection(config) {
  const { baseUrl, authToken, defaultSonnetModel, apiTimeoutMs, additionalEnvVars } = config;

  try {
    // Build client options
    const clientOptions = {};

    if (baseUrl) {
      clientOptions.baseURL = baseUrl;
    }
    if (authToken) {
      clientOptions.apiKey = authToken;
    }
    if (apiTimeoutMs) {
      clientOptions.timeout = apiTimeoutMs;
    }

    const client = new Anthropic(clientOptions);

    // Use a minimal message to test connectivity
    // This verifies: network, auth, and model availability
    const testModel = defaultSonnetModel || 'claude-sonnet-4-20250514';

    const response = await client.messages.create({
      model: testModel,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }]
    });

    return {
      success: true,
      message: 'Connection successful',
      details: {
        model: response.model,
        usage: response.usage
      }
    };
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
      details: {
        code: error.status || error.code,
        type: error.type || error.name
      }
    };
  }
}

function getErrorMessage(error) {
  if (error.status === 401) {
    return 'Authentication failed. Check your auth token.';
  }
  if (error.status === 404) {
    return 'Model not found. Check the model ID.';
  }
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return 'Could not connect to server. Check the base URL.';
  }
  if (error.code === 'ETIMEDOUT') {
    return 'Connection timed out. Try increasing the timeout.';
  }
  return error.message || 'Unknown error occurred';
}
```

#### Update: `packages/server/src/app.js`

```javascript
import providersRouter from './api/providers.js';
// ...
app.use('/api/providers', providersRouter);
```

#### Update: `packages/server/src/api/projects.js`

- Accept `providerId` when creating sessions
- Include provider resolution in session creation flow

#### Update: `packages/server/src/api/sessions.js`

- Add endpoint to update session provider: `PATCH /api/sessions/:id/provider`

---

### Phase 4: Shared Types & Contracts

#### Update: `packages/shared/src/types.js`

```javascript
/**
 * @typedef {Object} ModelProvider
 * @property {string} id
 * @property {string} name
 * @property {string} [baseUrl]
 * @property {string} [authToken]
 * @property {string} [defaultOpusModel]
 * @property {string} [defaultSonnetModel]
 * @property {string} [defaultHaikuModel]
 * @property {number} [apiTimeoutMs]
 * @property {Object} [additionalEnvVars]
 * @property {boolean} isDefault
 * @property {boolean} isBuiltIn
 */

/**
 * @typedef {Object} ProviderModel
 * @property {string} id
 * @property {string} providerId
 * @property {string} modelId
 * @property {string} displayName
 * @property {string} [description]
 * @property {'opus'|'sonnet'|'haiku'|'custom'} tier
 */
```

#### New File: `packages/shared/src/contracts/provider.js`

Zod schemas for API validation:

```javascript
import { z } from 'zod';

export const CreateProviderSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url().optional(),
  authToken: z.string().optional(),
  defaultOpusModel: z.string().optional(),
  defaultSonnetModel: z.string().optional(),
  defaultHaikuModel: z.string().optional(),
  apiTimeoutMs: z.number().positive().optional(),
  additionalEnvVars: z.record(z.string()).optional()
});

export const UpdateProviderSchema = CreateProviderSchema.partial();

export const CreateProviderModelSchema = z.object({
  modelId: z.string().min(1),
  displayName: z.string().min(1).max(100),
  description: z.string().optional(),
  tier: z.enum(['opus', 'sonnet', 'haiku', 'custom']).optional()
});
```

---

### Phase 5: Frontend - Pinia Store

#### New File: `packages/web/src/stores/providers.js`

```javascript
import { defineStore } from 'pinia';
import { apiClient } from '@/api';

export const useProvidersStore = defineStore('providers', {
  state: () => ({
    providers: [],
    loading: false,
    error: null
  }),

  getters: {
    defaultProvider: (state) => state.providers.find(p => p.isDefault),
    customProviders: (state) => state.providers.filter(p => !p.isBuiltIn),
    getById: (state) => (id) => state.providers.find(p => p.id === id)
  },

  actions: {
    async fetchProviders() { ... },
    async createProvider(provider) { ... },
    async updateProvider(id, updates) { ... },
    async deleteProvider(id) { ... },
    async setDefault(id) { ... },

    // Connection testing
    async testConnection(config) { ... },      // Test before saving
    async testExistingProvider(id) { ... },    // Test saved provider

    // Model management
    async fetchModels(providerId) { ... },
    async addModel(providerId, model) { ... },
    async removeModel(providerId, modelId) { ... }
  }
});
```

---

### Phase 6: Frontend - UI Components

#### New View: `packages/web/src/views/ProvidersView.vue`

Settings page for managing providers:

```
┌─────────────────────────────────────────────────────────────┐
│ Model Providers                              [+ Add Provider]│
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ★ Anthropic (Built-in)                          DEFAULT │ │
│ │   Uses official Anthropic API                           │ │
│ │   Models: Opus 4.5, Sonnet 4.5, Haiku 4.5              │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │   AWS Bedrock                    [Edit] [Delete] [Set ★]│ │
│ │   https://bedrock.us-east-1...                          │ │
│ │   Models: anthropic.claude-v3-opus, ...                 │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │   My Local Proxy                 [Edit] [Delete] [Set ★]│ │
│ │   http://localhost:8080                                 │ │
│ │   Models: custom-model-1, custom-model-2                │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### New Component: `packages/web/src/components/ProviderForm.vue`

Modal/form for creating/editing providers:

```
┌─────────────────────────────────────────────────────────────┐
│ Add Provider                                            [X] │
├─────────────────────────────────────────────────────────────┤
│ Provider Name*                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ AWS Bedrock                                             │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Base URL (ANTHROPIC_BASE_URL)                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ https://bedrock-runtime.us-east-1.amazonaws.com         │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Auth Token (ANTHROPIC_AUTH_TOKEN)                           │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ••••••••••••••••                              [Show]    │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ▼ Default Model Mappings (optional)                         │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Opus Model:   anthropic.claude-3-opus-20240229-v1:0     │ │
│ │ Sonnet Model: anthropic.claude-3-sonnet-20240229-v1:0   │ │
│ │ Haiku Model:  anthropic.claude-3-haiku-20240307-v1:0    │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ▼ Advanced Settings                                         │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ API Timeout (ms): 120000                                │ │
│ │                                                         │ │
│ │ Additional Environment Variables                         │
│ │ ┌─────────────────┐ ┌─────────────────┐ [+]             │ │
│ │ │ AWS_REGION      │ │ us-east-1       │                 │ │
│ │ └─────────────────┘ └─────────────────┘                 │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│                     [Test Connection] [Cancel] [Save]       │
└─────────────────────────────────────────────────────────────┘
```

**Test Connection Button Behavior:**
- Validates form fields before testing
- Shows loading spinner during test
- Displays success/error toast with details
- On success: Shows model name and confirms connectivity
- On failure: Shows specific error message (auth failed, invalid URL, model not found, timeout, etc.)

#### Update: `packages/web/src/components/ModelSelector.vue`

Modify to:
1. Show models grouped by provider
2. Allow selecting provider first, then model
3. Support custom model entry for custom providers

```
┌─────────────────────────────────────────────────────────────┐
│ Model                                                    ▼  │
├─────────────────────────────────────────────────────────────┤
│ ── Anthropic (Default) ──                                   │
│   ○ Opus 4.5 (Most capable)                                │
│   ● Sonnet 4.5 (Balanced)                                  │
│   ○ Haiku 4.5 (Fast)                                       │
│ ── AWS Bedrock ──                                          │
│   ○ anthropic.claude-3-opus                                │
│   ○ anthropic.claude-3-sonnet                              │
│ ── My Proxy ──                                             │
│   ○ custom-model-1                                         │
│   ○ + Enter custom model ID...                             │
└─────────────────────────────────────────────────────────────┘
```

#### Update Router: `packages/web/src/router.js`

```javascript
{
  path: '/settings/providers',
  name: 'providers',
  component: () => import('./views/ProvidersView.vue')
}
```

#### Update Navigation

Add link to Providers in sidebar/header navigation.

---

### Phase 7: Security Considerations

#### Auth Token Storage

The `authToken` field contains sensitive credentials. Options:

1. **Simple Approach** (Recommended for local-first app):
   - Store tokens in SQLite as-is
   - Document that the database should be protected
   - Match current behavior of other sensitive data

2. **Enhanced Security** (Optional future improvement):
   - Use encryption with a user-defined key
   - Store encrypted and decrypt at runtime

#### API Security

- Provider endpoints don't expose auth tokens in responses (redact to `"•••••••"`)
- Only show full token when explicitly requested with confirmation
- Validate provider configs before saving

---

## Implementation Order

### Step 1: Database (Est. 2 hours)
- [ ] Add `model_providers` table to schema.sql
- [ ] Add `provider_models` table to schema.sql
- [ ] Add migration in DatabaseManager.js
- [ ] Seed built-in Anthropic provider

### Step 2: Repository (Est. 2 hours)
- [ ] Create ModelProviderRepository.js
- [ ] Add unit tests

### Step 3: API Endpoints (Est. 3 hours)
- [ ] Create providers.js router
- [ ] Add Zod validation contracts
- [ ] Wire up to app.js
- [ ] Update projects.js and sessions.js

### Step 4: Connection Testing Service (Est. 2 hours)
- [ ] Create providerTestService.js
- [ ] Add test endpoints to providers.js router
- [ ] Handle various error cases with clear messages
- [ ] Add unit tests for error handling

### Step 5: Session Manager Integration (Est. 2 hours)
- [ ] Add provider resolution logic
- [ ] Implement buildProviderEnv()
- [ ] Test with mock provider

### Step 6: Frontend Store (Est. 1 hour)
- [ ] Create providers.js Pinia store
- [ ] Add API client methods (including testConnection)

### Step 7: Provider Management UI (Est. 5 hours)
- [ ] Create ProvidersView.vue
- [ ] Create ProviderForm.vue component with Test Connection button
- [ ] Implement test connection UI feedback (loading, success, error states)
- [ ] Add to router and navigation

### Step 8: Model Selector Update (Est. 2 hours)
- [ ] Update ModelSelector to show providers
- [ ] Support custom model entry
- [ ] Update NewSessionView integration

### Step 9: Testing (Est. 3 hours)
- [ ] Unit tests for repository
- [ ] Unit tests for session manager
- [ ] E2E tests for provider management
- [ ] E2E tests for connection testing
- [ ] E2E tests for session creation with custom provider

---

## Total Estimated Effort

**~22 hours** of development work

---

## Future Enhancements

1. **Provider Templates** - Pre-configured settings for popular providers (AWS Bedrock, Vertex AI, etc.)
2. **Token Encryption** - Enhanced security for stored credentials
3. **Import/Export** - Backup and restore provider configurations
4. **Per-Provider Usage Tracking** - Track token usage by provider
5. **Scheduled Health Checks** - Periodic background validation of provider connectivity
