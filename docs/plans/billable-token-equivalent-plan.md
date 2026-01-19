# Billable Token Equivalent (BTE) Implementation Plan

## Overview

Implement a cost-weighted token score that helps users understand the true billing impact of their API usage. Consolidate token display with the conversation selector for a unified, informative UI.

---

## Real-Time Updates & Known Issues

### Current Behavior (Keep)

The token UI currently supports real-time updates during streaming:

1. **WebSocket streaming** - Token counts update live as Claude generates responses
2. **Backup polling** - Periodic polling ensures counts stay accurate if WebSocket events are missed

**Both mechanisms must be preserved** in the new BTE implementation.

### Known Bug (Fix)

**Issue:** Token counts sometimes display incorrectly:
- Shows "0" or "-" when tokens have actually been used
- Displays random/stale values after conversation switches
- Inconsistent counts between conversation list and detail panel

**Root cause:** Likely race conditions between:
- `runningUsage` (streaming state) and persisted conversation tokens
- Conversation switching clearing state before new data loads
- WebSocket events arriving out of order

**Fix approach:**
- Ensure BTE calculation always has a valid fallback
- Clear `runningUsage` only after new conversation data is loaded
- Add defensive checks in the BTE getter

### Collapsed State Requirement

**Critical:** When the token breakdown is collapsed, the BTE (Cost) for the current conversation must:
- Remain visible in the compact header row
- Continue updating in real-time during streaming
- Reflect the same value shown in expanded state

```
┌───────────────────────────────┬───────────┬─────────────┐
│ 1st conversation           ▼  │ Cost: 88K │   [+ New]   │  ← Updates live
└───────────────────────────────┴───────────┴─────────────┘
```

---

## Part 1: Token Cost Weights Infrastructure

### 1.1 Shared Constants (Default Weights)

**File:** `packages/shared/src/constants.js`

```javascript
export const DEFAULT_TOKEN_COST_WEIGHTS = {
  input: 1.0,        // Base rate
  output: 5.0,       // 5x input cost
  cacheRead: 0.1,    // 90% discount
  cacheCreation: 1.25 // 25% premium
};
```

### 1.2 Shared Utility Function

**File:** `packages/shared/src/utils.js`

```javascript
export function calculateBillableTokens(usage, weights = DEFAULT_TOKEN_COST_WEIGHTS) {
  return Math.round(
    (usage.inputTokens || 0) * weights.input +
    (usage.outputTokens || 0) * weights.output +
    (usage.cacheReadInputTokens || 0) * weights.cacheRead +
    (usage.cacheCreationInputTokens || 0) * weights.cacheCreation
  );
}

export function formatTokenCount(n) {
  if (!n || n === 0) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
```

### 1.3 Database: App Settings Table

**File:** `packages/server/src/db/DatabaseManager.js`

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 1.4 Settings Repository

**File:** `packages/server/src/db/SettingsRepository.js`

- `getTokenCostWeights()` - Returns weights (with defaults fallback)
- `setTokenCostWeights(weights)` - Saves custom weights

### 1.5 Settings API

**File:** `packages/server/src/api/settings.js`

```
GET  /api/settings/token-weights
PUT  /api/settings/token-weights
```

---

## Part 2: Consolidated Conversation & Token UI

### 2.1 Current State (Before)

```
┌─────────────────────────────────────────────────────────────┐
│ Session Detail View                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ TokenUsagePanel (separate component)                │   │
│  │ ┌─────────────────────────────────────────────────┐ │   │
│  │ │  Total: 45.2K tokens                       ▼    │ │   │
│  │ └─────────────────────────────────────────────────┘ │   │
│  │ (expandable details: input, output, cache)          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ConversationSelector (separate component)           │   │
│  │ ┌─────────────────────────────────────────────────┐ │   │
│  │ │  1st conversation ▼  │  [+ New]                 │ │   │
│  │ └─────────────────────────────────────────────────┘ │   │
│  │                                                     │   │
│  │ Dropdown shows:                                     │   │
│  │ ┌─────────────────────────────────────────────────┐ │   │
│  │ │ ● 1st conversation    12 msgs · 45.2K          │ │   │
│  │ │   2nd conversation     8 msgs · 32.1K          │ │   │
│  │ │   └─ Branch 1          3 msgs · 15.0K          │ │   │
│  │ └─────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Conversation Messages                               │   │
│  │ ...                                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Problems:**
- Token panel and conversation selector are separate
- Token counts in dropdown don't match panel (different calculations)
- Redundant UI elements
- No BTE (billable token equivalent) shown

---

### 2.2 Proposed State (After)

```
┌─────────────────────────────────────────────────────────────┐
│ Session Detail View                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ConversationPanel (unified component)               │   │
│  │                                                     │   │
│  │ ┌───────────────────────────────────┬─────────────┐ │   │
│  │ │ 1st conversation              ▼   │   [+ New]   │ │   │
│  │ └───────────────────────────────────┴─────────────┘ │   │
│  │                                                     │   │
│  │ ┌─────────────────────────────────────────────────┐ │   │
│  │ │                                                 │ │   │
│  │ │   Cost: 87.5K                                  │ │   │
│  │ │                                                 │ │   │
│  │ │   ┌─────────┬─────────┬─────────┬───────────┐  │ │   │
│  │ │   │ Input   │ Output  │ Cache R │ Cache C   │  │ │   │
│  │ │   │ 32.0K   │ 10.5K   │ 45.0K   │ 2.0K      │  │ │   │
│  │ │   │ ×1.0    │ ×5.0    │ ×0.1    │ ×1.25     │  │ │   │
│  │ │   │ =32.0K  │ =52.5K  │ =4.5K   │ =2.5K     │  │ │   │
│  │ │   └─────────┴─────────┴─────────┴───────────┘  │ │   │
│  │ │                                        [⚙]     │ │   │
│  │ └─────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Conversation Messages                               │   │
│  │ ...                                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 2.3 Conversation Dropdown (Updated)

```
┌─────────────────────────────────────────────────────────────┐
│ Conversation Dropdown                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ● 1st conversation                                  │   │
│  │   12 messages  ·  Cost: 87.5K                      │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │   2nd conversation                                  │   │
│  │   8 messages   ·  Cost: 62.1K                      │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │   └─ Branch from msg #5                             │   │
│  │      3 messages ·  Cost: 28.0K                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 2.4 Token Weights Settings Modal

```
┌─────────────────────────────────────────────────────────────┐
│ Token Cost Weights                                     [×]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Configure how different token types are weighted when      │
│  calculating the cost score. Weights are relative to        │
│  input tokens (1.0 = same cost as input).                   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  Input Tokens           [  1.0  ]  (base rate)     │   │
│  │                                                     │   │
│  │  Output Tokens          [  5.0  ]  (5× input)      │   │
│  │                                                     │   │
│  │  Cache Read Tokens      [  0.1  ]  (90% discount)  │   │
│  │                                                     │   │
│  │  Cache Creation Tokens  [ 1.25  ]  (25% premium)   │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  [Reset to Defaults]              [Cancel] [Save]   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 2.5 Compact View (Collapsed State)

For when screen space is limited or user prefers minimal UI:

```
┌─────────────────────────────────────────────────────────────┐
│ ┌───────────────────────────────┬───────────┬─────────────┐ │
│ │ 1st conversation           ▼  │ Cost: 88K │   [+ New]   │ │
│ └───────────────────────────────┴───────────┴─────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 3: Implementation Steps

### Phase 1: Infrastructure (Backend)
1. [ ] Add `DEFAULT_TOKEN_COST_WEIGHTS` to `shared/constants.js`
2. [ ] Add `calculateBillableTokens()` to `shared/utils.js`
3. [ ] Create `app_settings` table migration in `DatabaseManager.js`
4. [ ] Create `SettingsRepository.js`
5. [ ] Create `/api/settings` routes
6. [ ] Add tests for BTE calculation

### Phase 2: Store & State (Frontend)
7. [ ] Create `settings` Pinia store (or extend existing)
8. [ ] Add `fetchTokenWeights()` action
9. [ ] Add `billableTokens` getter to sessions store
10. [ ] Update `formattedTokens` getter to include BTE

### Phase 3: UI Components
11. [ ] Create `TokenWeightsModal.vue` component
12. [ ] Create unified `ConversationPanel.vue` component
13. [ ] Update `ConversationTreeItem.vue` to show BTE
14. [ ] Remove/deprecate separate `TokenUsagePanel.vue`
15. [ ] Add settings gear icon to open weights modal

### Phase 4: Real-Time Updates & Bug Fixes
16. [ ] Ensure BTE updates in real-time during streaming (preserve existing WebSocket behavior)
17. [ ] Ensure backup polling updates BTE correctly
18. [ ] Fix token count bug: race conditions on conversation switch
19. [ ] Fix token count bug: ensure valid fallback when `runningUsage` is stale
20. [ ] Verify collapsed view shows live-updating BTE

### Phase 5: Testing
21. [ ] E2E tests for token weights settings
22. [ ] E2E tests for BTE display consistency across expanded/collapsed
23. [ ] E2E tests for real-time BTE updates during streaming
24. [ ] Update any existing token-related tests

---

## Part 4: Component Structure

```
packages/web/src/components/
├── conversation/
│   ├── ConversationPanel.vue      # NEW: Unified container
│   ├── ConversationSelector.vue   # Existing (refactored)
│   ├── ConversationTreeItem.vue   # Existing (updated)
│   └── TokenBreakdown.vue         # NEW: Expandable details
├── settings/
│   └── TokenWeightsModal.vue      # NEW: Weights editor
└── TokenUsagePanel.vue            # DEPRECATED
```

---

## Part 5: API Changes

### New Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings/token-weights` | Get current weights |
| PUT | `/api/settings/token-weights` | Update weights |

### Request/Response

```javascript
// GET /api/settings/token-weights
{
  "input": 1.0,
  "output": 5.0,
  "cacheRead": 0.1,
  "cacheCreation": 1.25
}

// PUT /api/settings/token-weights
// Same shape as GET response
```

---

## Part 6: Migration Notes

### Breaking Changes
- None (additive only)

### Deprecations
- `TokenUsagePanel.vue` - functionality merged into `ConversationPanel.vue`

### Data Migration
- None required - defaults work without database entries

---

## Part 7: Future Enhancements

1. **Per-project weights** - Override defaults for projects using different models
2. **Model-aware defaults** - Auto-select weights based on session model
3. **Cost history** - Track BTE over time for cost analysis
4. **Budget alerts** - Warn when BTE exceeds threshold
