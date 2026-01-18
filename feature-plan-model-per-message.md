# Feature Plan: Display Model Per Message

## Overview
Track and display which Claude model produced each response in the conversation view. This enables users to see which model generated each response when they change models mid-conversation.

---

## Current State

### Database
- `conversation_messages` table has: `id`, `session_id`, `conversation_id`, `role`, `content`, `tool_use`, `timestamp`
- **No `model` column** on messages
- Model is tracked at the `sessions` level (`model` column) and `conversations` level

### Backend
- `MessageRepository.create()` accepts: `sessionId, role, content, toolUse, conversationId`
- Session manager receives model info from Claude SDK's `system.init` event
- Model updates are stored on the session record, not individual messages

### Frontend
- `ConversationTab.vue` displays message role + timestamp in the header
- No model information displayed

---

## Implementation Plan

### Phase 1: Database Schema Update

**File: `packages/server/src/schema.sql`**
```sql
-- Add model column to conversation_messages
ALTER TABLE conversation_messages ADD COLUMN model TEXT;
```

**File: `packages/server/src/db/DatabaseManager.js`**
- Add migration to add `model` column to existing databases

### Phase 2: Backend - Message Repository

**File: `packages/server/src/db/MessageRepository.js`**
1. Update `#mapMessage()` to include `model` field
2. Update `create()` method signature to accept optional `model` parameter
3. Update INSERT statement to include `model`

### Phase 3: Backend - Session Manager

**File: `packages/server/src/services/sessionManager.js`**
1. Track current model in a Map (keyed by sessionId) - updated on `system.init` events
2. Pass the current model when creating assistant messages
3. Model tracking flow:
   - `system.init` event -> update `currentModels.set(sessionId, event.model)`
   - `assistant` event -> `messages.create(..., currentModel)`

### Phase 4: Frontend - Conversation Display

**File: `packages/web/src/components/ConversationTab.vue`**
1. Update message header to show model for assistant messages
2. Display format: `assistant | claude-3-5-sonnet | 2:34:56 PM`
3. Only show model badge for assistant messages (user messages don't have a model)
4. Style the model name subtly (e.g., `text-gray-500`, smaller font)

### Phase 5: API Response Update

**File: `packages/server/src/api/sessions.js`**
- Ensure message responses include the `model` field

---

## Detailed Changes

### 1. Schema Migration (DatabaseManager.js)

```javascript
// In #runMigrations()
const messagesTableInfo = this.#db.prepare('PRAGMA table_info(conversation_messages)').all();
const messagesColumns = messagesTableInfo.map((col) => col.name);

if (!messagesColumns.includes('model')) {
  this.#db.exec('ALTER TABLE conversation_messages ADD COLUMN model TEXT');
}
```

### 2. MessageRepository Changes

```javascript
// Updated create method
create(sessionId, role, content, toolUse = null, conversationId = null, model = null) {
  const id = databaseManager.generateId();
  const now = Date.now();
  this.db
    .prepare(
      `INSERT INTO conversation_messages (id, session_id, conversation_id, role, content, tool_use, timestamp, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, sessionId, conversationId, role, content, toolUse ? JSON.stringify(toolUse) : null, now, model);
  return this.getById(id);
}

// Updated mapper
static #mapMessage(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    toolUse: row.tool_use ? JSON.parse(row.tool_use) : null,
    timestamp: row.timestamp,
    model: row.model,  // NEW
  };
}
```

### 3. Session Manager Changes

```javascript
// Add Map to track current model per session
const currentModels = new Map();

// In handleStreamEvent(), case 'system':
if (event.subtype === 'init') {
  currentModels.set(sessionId, event.model);  // Track model for this session
  // ... existing code
}

// In handleStreamEvent(), case 'assistant':
const currentModel = currentModels.get(sessionId);
const message = messages.create(sessionId, 'assistant', textContent, toolUse, conversationId, currentModel);

// Clean up in finally blocks
currentModels.delete(sessionId);
```

### 4. ConversationTab.vue Changes

```vue
<div class="message-header">
  <span class="message-role">{{ message.role }}</span>
  <!-- Show model for assistant messages -->
  <span v-if="message.role === 'assistant' && message.model" class="message-model">
    {{ formatModelName(message.model) }}
  </span>
  <span class="message-time">{{ formatTime(message.timestamp) }}</span>
</div>

<script setup>
// Add helper to format model name nicely
function formatModelName(model) {
  if (!model) return '';
  // Convert "claude-3-5-sonnet-20241022" to "claude-3.5-sonnet"
  return model
    .replace(/-(\d{8})$/, '')  // Remove date suffix
    .replace(/-(\d)-(\d)-/, '-$1.$2-');  // Convert 3-5 to 3.5
}
</script>

<style scoped>
.message-model {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  padding: 0.125rem 0.375rem;
  background: var(--color-background-mute);
  border-radius: 0.25rem;
  margin-left: 0.5rem;
}
</style>
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/server/src/schema.sql` | Add `model TEXT` column to `conversation_messages` |
| `packages/server/src/db/DatabaseManager.js` | Add migration for `model` column |
| `packages/server/src/db/MessageRepository.js` | Update create() and mapper to handle model |
| `packages/server/src/services/sessionManager.js` | Track model per session, pass to message creation |
| `packages/web/src/components/ConversationTab.vue` | Display model in message header |

---

## Testing Considerations

1. **Migration testing**: Ensure existing databases upgrade correctly
2. **New messages**: Verify model is captured for new assistant messages
3. **Model changes**: Test mid-conversation model switching shows correct model per message
4. **Null handling**: User messages should display correctly without model
5. **UI consistency**: Model badge should not break header layout

---

## Rollout

1. Implement backend changes first (schema, repository, session manager)
2. Deploy backend - existing messages will have `model: null`
3. Implement frontend changes
4. New messages will show model; old messages will gracefully hide the badge
