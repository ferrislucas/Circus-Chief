# Conversation Branching Feature - Implementation Plan

## Overview

Enable users to branch a **conversation** at any turn within a session. This creates a new conversation thread that preserves messages up to the branch point, allowing users to explore alternative directions while keeping everything within the same session.

---

## Feature Summary

### User Story
> "I'm 20 exchanges into a conversation and realize I want to try a different approach at exchange #5. I click on my message at that point, edit it, and a new conversation is created that branches from there—all within the same session."

### Key UX Goals
1. **In-context** - Everything stays within the same session
2. **Smooth** - Inline editing, no page navigation
3. **Clear Lineage** - Conversation selector shows the tree structure
4. **Quick** - Branch in 2 clicks (hover → click → edit → submit)

---

## Architecture

### Current State
- Sessions contain multiple Conversations
- Conversations contain Messages
- ConversationSelector is a dropdown showing all conversations
- Each conversation has: `id`, `session_id`, `name`, `summary`, `is_active`, etc.

### Required Changes

#### Database Schema Extension
```sql
-- Add to conversations table
ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT
  REFERENCES conversations(id) ON DELETE SET NULL;

ALTER TABLE conversations ADD COLUMN branch_from_message_id TEXT
  REFERENCES conversation_messages(id) ON DELETE SET NULL;
```

This allows:
- Tracking parent-child relationships between conversations
- Knowing exactly which message the branch originated from
- Building a tree structure for the UI

---

## Implementation Phases

### Phase 1: Backend Foundation

#### 1.1 Database Migration
**File:** `packages/server/src/db/migrations/add_conversation_branching.js`

```javascript
export function up(db) {
  db.exec(`
    ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT
      REFERENCES conversations(id) ON DELETE SET NULL;
    ALTER TABLE conversations ADD COLUMN branch_from_message_id TEXT
      REFERENCES conversation_messages(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_conversations_parent
      ON conversations(parent_conversation_id);
  `);
}
```

#### 1.2 Conversation Repository Updates
**File:** `packages/server/src/db/ConversationRepository.js`

Add methods:
- `getWithBranchInfo(id)` - Include parent conversation and branch message details
- `getTreeBySessionId(sessionId)` - Return conversations as a tree structure
- `branch(conversationId, messageId, newContent)` - Create a branched conversation

```javascript
branch(conversationId, messageId, newContent) {
  // 1. Get source conversation and validate
  const sourceConv = this.getById(conversationId);
  const sourceMessage = this.db.prepare(
    'SELECT * FROM conversation_messages WHERE id = ?'
  ).get(messageId);

  // 2. Get all messages UP TO (not including) the branch point
  const messagesToCopy = this.db.prepare(`
    SELECT * FROM conversation_messages
    WHERE conversation_id = ? AND timestamp < ?
    ORDER BY timestamp ASC
  `).all(conversationId, sourceMessage.timestamp);

  // 3. Create new conversation with parent reference
  const newConv = this.create(sourceConv.sessionId, null, true);
  this.db.prepare(`
    UPDATE conversations
    SET parent_conversation_id = ?, branch_from_message_id = ?
    WHERE id = ?
  `).run(conversationId, messageId, newConv.id);

  // 4. Copy messages to new conversation
  for (const msg of messagesToCopy) {
    // Copy each message with new conversation_id
  }

  // 5. Create the new user message with edited content
  this.messageRepo.create(
    sourceConv.sessionId,
    'user',
    newContent,
    null,
    newConv.id
  );

  return newConv;
}
```

#### 1.3 New Branch API Endpoint
**File:** `packages/server/src/api/sessions.js`

```
POST /api/sessions/:sessionId/conversations/:conversationId/branch
```

**Request Body:**
```json
{
  "messageId": "msg-123",           // The user message to branch from
  "newContent": "My edited prompt"  // The replacement content
}
```

**Response:**
```json
{
  "conversation": {
    "id": "new-conv-id",
    "parentConversationId": "original-conv-id",
    "branchFromMessageId": "msg-123",
    ...
  }
}
```

**Implementation Logic:**
1. Validate messageId belongs to this conversation
2. Validate it's a user message (can only branch from user messages)
3. Copy messages up to (not including) the branch point
4. Create new conversation with parent reference
5. Add the new user message with edited content
6. Set new conversation as active
7. Start Claude agent to respond
8. Return new conversation

#### 1.4 Update Conversation List Response
Include branch info in conversation responses:

```json
{
  "id": "conv-id",
  "name": "Alternative approach",
  "parentConversationId": "parent-conv-id",
  "branchFromMessageId": "msg-id",
  "branchInfo": {
    "parentName": "Main conversation",
    "branchMessagePreview": "Help me implement...",
    "depth": 2
  },
  "childCount": 1,
  "messageCount": 15
}
```

---

### Phase 2: Frontend - Branching Trigger

#### 2.1 Message Hover Actions
**File:** `packages/web/src/components/ConversationTab.vue`

Add a subtle branch button that appears on hover for user messages:

```vue
<!-- In the message rendering loop -->
<div
  v-for="message in messages"
  :key="message.id"
  class="message-wrapper group relative"
>
  <!-- Existing message bubble -->
  <div :class="['message', message.role]">
    {{ message.content }}
  </div>

  <!-- Branch action for user messages -->
  <button
    v-if="message.role === 'user'"
    @click="startBranch(message)"
    class="branch-trigger"
    title="Edit & branch from here"
  >
    <GitBranchIcon class="w-4 h-4" />
  </button>
</div>

<style scoped>
.branch-trigger {
  position: absolute;
  left: -2.5rem;
  top: 0.5rem;
  padding: 0.375rem;
  border-radius: 0.5rem;
  background: rgba(31, 41, 55, 0.8);
  color: #9ca3af;
  opacity: 0;
  transition: all 0.15s ease;
}

.message-wrapper:hover .branch-trigger {
  opacity: 1;
}

.branch-trigger:hover {
  background: rgba(31, 41, 55, 1);
  color: #22d3ee; /* cyan-400 */
}
</style>
```

#### 2.2 Inline Branch Editor
**File:** `packages/web/src/components/BranchEditor.vue` (new)

When the user clicks the branch button, show an inline editor that slides in below the message:

```vue
<template>
  <Transition name="slide-fade">
    <div v-if="visible" class="branch-editor">
      <div class="branch-header">
        <GitBranchIcon class="w-4 h-4 text-cyan-400" />
        <span>Edit & branch from this point</span>
      </div>

      <textarea
        ref="textareaRef"
        v-model="editedContent"
        class="branch-textarea"
        rows="4"
        placeholder="Edit your message..."
        @keydown.meta.enter="submit"
        @keydown.ctrl.enter="submit"
        @keydown.escape="cancel"
      />

      <div class="branch-footer">
        <span class="branch-hint">
          {{ messagesBelowCount }} message{{ messagesBelowCount !== 1 ? 's' : '' }}
          below will not be copied
        </span>
        <div class="branch-actions">
          <button @click="cancel" class="btn-cancel">Cancel</button>
          <button
            @click="submit"
            :disabled="!editedContent.trim() || isSubmitting"
            class="btn-submit"
          >
            <GitBranchIcon v-if="!isSubmitting" class="w-4 h-4" />
            <LoadingSpinner v-else class="w-4 h-4" />
            Create Branch
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
```

**Behavior:**
- Auto-focus textarea on open
- Pre-fill with original message content
- Cmd/Ctrl+Enter to submit
- Escape to cancel
- Show loading state during creation
- Smooth slide animation

---

### Phase 3: Conversation Selector - Tree UI

This is the **critical UX piece** - the ConversationSelector must visualize the lineage.

#### 3.1 Tree Structure Design

Transform from flat dropdown to hierarchical tree:

**Current (flat):**
```
▼ 3rd conversation
  - 1st conversation (5 msgs)
  - 2nd conversation (12 msgs)
  - 3rd conversation (8 msgs)  ← active
```

**New (tree with lineage):**
```
▼ Alternative JWT approach

  ├─ Main conversation (20 msgs)
  │  ├─ Try with Redis (8 msgs)
  │  │  └─ Redis + clustering (3 msgs)
  │  └─ Try with sessions (12 msgs)  ← active
  └─ Fresh start (5 msgs)
```

#### 3.2 ConversationSelector Redesign
**File:** `packages/web/src/components/ConversationSelector.vue`

Key changes:
1. Fetch conversations with tree structure from API
2. Render as indented tree with connector lines
3. Show branch icons for branched conversations
4. Highlight the current active conversation
5. Allow collapse/expand of branches

```vue
<template>
  <div class="conversation-selector">
    <button class="selector-trigger" @click="toggleOpen">
      <span class="active-name">{{ activeConversationName }}</span>
      <ChevronDownIcon class="w-4 h-4" />
    </button>

    <Transition name="dropdown">
      <div v-if="isOpen" class="selector-dropdown">
        <!-- Tree rendering -->
        <ConversationTreeItem
          v-for="conv in rootConversations"
          :key="conv.id"
          :conversation="conv"
          :children="getChildren(conv.id)"
          :depth="0"
          :active-id="activeConversationId"
          @select="selectConversation"
          @delete="deleteConversation"
        />

        <!-- New conversation button -->
        <button class="btn-new-conversation" @click="createNew">
          <PlusIcon class="w-4 h-4" />
          New conversation
        </button>
      </div>
    </Transition>
  </div>
</template>
```

#### 3.3 ConversationTreeItem Component
**File:** `packages/web/src/components/ConversationTreeItem.vue` (new)

Recursive component for rendering tree nodes:

```vue
<template>
  <div class="tree-item">
    <!-- This conversation -->
    <div
      :class="['tree-node', { active: isActive, 'has-children': hasChildren }]"
      :style="{ paddingLeft: `${depth * 1.25}rem` }"
      @click="$emit('select', conversation.id)"
    >
      <!-- Branch indicator line -->
      <div v-if="depth > 0" class="branch-line" />

      <!-- Icon -->
      <component
        :is="isBranch ? GitBranchIcon : MessageSquareIcon"
        class="w-4 h-4"
        :class="isBranch ? 'text-cyan-400' : 'text-gray-500'"
      />

      <!-- Name & meta -->
      <div class="node-content">
        <span class="node-name">{{ displayName }}</span>
        <span class="node-meta">{{ conversation.messageCount }} msgs</span>
      </div>

      <!-- Actions -->
      <button
        v-if="!isActive && canDelete"
        @click.stop="$emit('delete', conversation.id)"
        class="btn-delete"
      >
        <XIcon class="w-3 h-3" />
      </button>
    </div>

    <!-- Children (recursive) -->
    <ConversationTreeItem
      v-for="child in children"
      :key="child.id"
      :conversation="child"
      :children="getChildrenOf(child.id)"
      :depth="depth + 1"
      :active-id="activeId"
      @select="$emit('select', $event)"
      @delete="$emit('delete', $event)"
    />
  </div>
</template>

<style scoped>
.tree-node {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  border-radius: 0.375rem;
  transition: background 0.15s;
}

.tree-node:hover {
  background: rgba(55, 65, 81, 0.5);
}

.tree-node.active {
  background: rgba(34, 211, 238, 0.1);
  border-left: 2px solid #22d3ee;
}

.branch-line {
  position: absolute;
  left: calc(var(--depth) * 1.25rem - 0.75rem);
  top: 0;
  bottom: 50%;
  width: 0.75rem;
  border-left: 1px solid #374151;
  border-bottom: 1px solid #374151;
  border-bottom-left-radius: 0.25rem;
}

.node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #f3f4f6;
}

.node-meta {
  font-size: 0.75rem;
  color: #6b7280;
}
</style>
```

#### 3.4 Visual Tree Connectors

Use CSS to draw tree connector lines:

```
├─ Parent conversation
│  ├─ Child branch 1
│  │  └─ Grandchild
│  └─ Child branch 2
```

This creates visual hierarchy that clearly shows lineage.

---

### Phase 4: Session Store Updates

#### 4.1 Store State
**File:** `packages/web/src/stores/sessions.js`

Add tree-related state and actions:

```javascript
state: () => ({
  // ...existing
  conversations: [],
  conversationTree: null, // Computed tree structure
}),

getters: {
  // Root conversations (no parent)
  rootConversations: (state) => {
    return state.conversations.filter(c => !c.parentConversationId);
  },

  // Get children of a conversation
  getChildren: (state) => (parentId) => {
    return state.conversations.filter(c => c.parentConversationId === parentId);
  },

  // Build full tree structure
  conversationTree: (state) => {
    const buildTree = (parentId = null, depth = 0) => {
      return state.conversations
        .filter(c => c.parentConversationId === parentId)
        .map(c => ({
          ...c,
          depth,
          children: buildTree(c.id, depth + 1)
        }));
    };
    return buildTree();
  },

  // Get ancestors of a conversation (for breadcrumb)
  getAncestors: (state) => (conversationId) => {
    const ancestors = [];
    let current = state.conversations.find(c => c.id === conversationId);
    while (current?.parentConversationId) {
      current = state.conversations.find(c => c.id === current.parentConversationId);
      if (current) ancestors.unshift(current);
    }
    return ancestors;
  }
},

actions: {
  async branchConversation(sessionId, conversationId, messageId, newContent) {
    const response = await fetch(
      `/api/sessions/${sessionId}/conversations/${conversationId}/branch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, newContent })
      }
    );
    const data = await response.json();

    // Add new conversation to list
    this.conversations.push(data.conversation);

    // Switch to new conversation
    await this.switchConversation(sessionId, data.conversation.id);

    return data.conversation;
  }
}
```

---

### Phase 5: Polish & Enhancements

#### 5.1 Branch Origin Indicator
When viewing a branched conversation, show a subtle indicator at the top:

```vue
<div v-if="activeConversation?.parentConversationId" class="branch-origin-banner">
  <GitBranchIcon class="w-4 h-4 text-cyan-400" />
  <span class="text-gray-400">Branched from</span>
  <button @click="goToParent" class="text-cyan-400 hover:underline">
    {{ parentConversationName }}
  </button>
</div>
```

#### 5.2 Keyboard Shortcuts
- `B` while hovering a user message → Open branch editor
- `Escape` → Close branch editor
- `Cmd/Ctrl + Enter` → Submit branch

#### 5.3 Auto-naming Branches
Generate meaningful names:
- If parent has a name: "Alt: [Parent Name]"
- Based on edited content: First 30 chars of new message
- Fallback: "Branch #N"

#### 5.4 Toast Notifications
- "Branch created" with link to original conversation
- "Switched to [Conversation Name]"

---

## Visual Design Specifications

### Color Palette
| Element | Color | Tailwind |
|---------|-------|----------|
| Branch icon | Cyan | `text-cyan-400` |
| Tree lines | Gray | `border-gray-700` |
| Active conversation | Cyan bg | `bg-cyan-500/10` |
| Hover state | Gray | `bg-gray-700/50` |

### Icons (Lucide)
- `GitBranch` - Branch action / branched conversation indicator
- `MessageSquare` - Regular conversation
- `ChevronDown` - Dropdown arrow
- `X` - Delete action
- `Plus` - New conversation

### Animations
| Element | Duration | Easing |
|---------|----------|--------|
| Branch editor slide | 200ms | ease-out |
| Dropdown open | 150ms | ease-out |
| Hover transitions | 150ms | ease |

---

## API Reference

### Create Branch
```
POST /api/sessions/:sessionId/conversations/:conversationId/branch

Request:
{
  "messageId": "string",    // Required: The user message to branch from
  "newContent": "string"    // Required: The edited message content
}

Response:
{
  "conversation": {
    "id": "string",
    "sessionId": "string",
    "parentConversationId": "string",
    "branchFromMessageId": "string",
    "name": "string | null",
    "messageCount": number,
    "createdAt": number
  }
}
```

### Get Conversations (Updated)
```
GET /api/sessions/:sessionId/conversations

Response:
{
  "conversations": [
    {
      "id": "string",
      "name": "string | null",
      "parentConversationId": "string | null",
      "branchFromMessageId": "string | null",
      "branchInfo": {
        "parentName": "string | null",
        "branchMessagePreview": "string | null",
        "depth": number,
        "childCount": number
      },
      "messageCount": number,
      "isActive": boolean,
      ...
    }
  ]
}
```

---

## File Changes Summary

### New Files
| File | Description |
|------|-------------|
| `packages/server/src/db/migrations/add_conversation_branching.js` | Migration for new columns |
| `packages/web/src/components/BranchEditor.vue` | Inline editor for branching |
| `packages/web/src/components/ConversationTreeItem.vue` | Tree node component |

### Modified Files
| File | Changes |
|------|---------|
| `packages/server/src/db/ConversationRepository.js` | Add branch method, tree queries |
| `packages/server/src/api/sessions.js` | Add branch endpoint |
| `packages/web/src/components/ConversationTab.vue` | Add branch trigger on messages |
| `packages/web/src/components/ConversationSelector.vue` | Tree-based UI redesign |
| `packages/web/src/stores/sessions.js` | Tree getters, branch action |
| `packages/server/src/schema.sql` | Document new columns |

---

## Testing Strategy

### Unit Tests
- ConversationRepository.branch() correctly copies messages
- Tree building logic with nested conversations
- API validates message ownership

### Integration Tests
- Branch creation copies correct messages
- New conversation becomes active
- Parent-child relationships persist

### E2E Tests
- Hover on message → branch button appears
- Click branch → editor opens with content
- Submit → new conversation created and active
- Conversation selector shows tree correctly
- Navigate between parent/child conversations

---

## Implementation Order

### Week 1: Backend
- [ ] Database migration
- [ ] ConversationRepository.branch() method
- [ ] Branch API endpoint
- [ ] Update conversation list to include branch info

### Week 2: Frontend Core
- [ ] BranchEditor component
- [ ] Message hover actions in ConversationTab
- [ ] Store action for branching
- [ ] API integration

### Week 3: Conversation Selector Tree
- [ ] ConversationTreeItem component
- [ ] Redesign ConversationSelector with tree
- [ ] Tree connector styling
- [ ] Expand/collapse behavior

### Week 4: Polish
- [ ] Animations and transitions
- [ ] Branch origin banner
- [ ] Auto-naming logic
- [ ] Testing and bug fixes

---

## Open Questions

1. **Branch naming**: How should branches be named?
   - Option A: Auto-generate from edited content
   - Option B: Prompt user for name
   - Option C: "Branch of [Parent]" pattern

2. **Max depth**: Limit nesting depth?
   - Recommendation: No hard limit, tree handles any depth

3. **Branch from assistant?**: Allow branching from assistant responses?
   - Recommendation: No - only user messages (clearer mental model)

---

## Success Metrics

- Users can branch a conversation in 3 clicks
- Tree structure is immediately understandable
- No confusion about which conversation is active
- Smooth, polished animations throughout
