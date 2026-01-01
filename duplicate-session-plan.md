# Implementation Plan: Duplicate Session Feature

## Overview

Add the ability to duplicate a session from the session detail view's conversation tab. The duplicated session will include all conversations, messages, canvas items, and session notes, with proper handling for different git modes.

---

## Session Types & Git Modes

Sessions can have three different git configurations that must be handled differently during duplication:

### Git Mode: None (No Git Setup)
- **Storage**: `gitBranch: null`, `gitWorktree: null`
- **Working Directory**: Uses project's main directory directly
- **Duplication**: Simplest case - just copy data, no git setup needed

### Git Mode: Branch
- **Storage**: `gitBranch: "feature-name"`, `gitWorktree: null`
- **Working Directory**: Project's main directory with branch checked out
- **Duplication**: Need to checkout (or create) the branch in main directory
- **Note**: Multiple sessions can share the same branch

### Git Mode: Worktree (Isolated)
- **Storage**: `gitBranch: "feature-name"`, `gitWorktree: "/path/.worktrees/{sessionId}"`
- **Working Directory**: Isolated worktree at `.worktrees/{sessionId}`
- **Duplication**: Must create a NEW worktree with the NEW session ID
- **Note**: Each session has completely isolated working directory

**Important**: `gitMode` is NOT stored in the sessions table - it must be inferred:
```javascript
const gitMode = session.gitWorktree ? 'worktree'
              : session.gitBranch ? 'branch'
              : null;
```

---

## Data to Duplicate

| Copy | Don't Copy |
|------|------------|
| Session settings (name, mode, model, thinkingEnabled) | id (generate new) |
| All conversations (with new IDs) | status (set to 'waiting') |
| All messages per conversation | gitWorktree (create fresh if needed) |
| All canvas items | prUrl, error, claudeSessionId |
| All session notes | createdAt, updatedAt (new timestamps) |
| gitBranch (for branch/worktree modes) | |
| contextWindow | |
| Token counts (inputTokens, outputTokens, etc.) | |
| costUsd | |
| Session summary | |
| Conversation summaries | |

---

## Implementation Tasks

### 1. Backend: SessionRepository.duplicate()

**File:** `packages/server/src/db/SessionRepository.js`

Add method to duplicate the session record (without git setup):

```javascript
/**
 * Duplicates a session with a new ID and reset state.
 * Does NOT handle git setup - that's done by the service layer.
 * @param {string} sourceSessionId - ID of session to duplicate
 * @param {object} options - Override options
 * @param {string} [options.name] - New name (defaults to "Original Name (Copy)")
 * @returns {object} The new session record
 */
duplicate(sourceSessionId, { name } = {}) {
  const source = this.findById(sourceSessionId);
  if (!source) {
    throw new Error(`Session not found: ${sourceSessionId}`);
  }

  // Create new session with same settings (preserving token counts and cost)
  const newSession = this.create({
    projectId: source.projectId,
    name: name || `${source.name} (Copy)`,
    mode: source.mode,
    thinkingEnabled: source.thinkingEnabled,
    model: source.model,
    gitBranch: source.gitBranch,  // Copy branch name (worktree path handled separately)
    status: 'waiting',            // Always start as draft
    contextWindow: source.contextWindow
  });

  // Copy token counts and cost from source
  this.update(newSession.id, {
    inputTokens: source.inputTokens,
    outputTokens: source.outputTokens,
    cacheReadInputTokens: source.cacheReadInputTokens,
    cacheCreationInputTokens: source.cacheCreationInputTokens,
    webSearchRequests: source.webSearchRequests,
    costUsd: source.costUsd
  });

  return this.findById(newSession.id);
}
```

#### Tests for SessionRepository.duplicate()

**File:** `packages/server/src/db/SessionRepository.test.js`

```javascript
describe('duplicate()', () => {
  it('should create a new session with same settings', () => {
    const original = sessions.create({
      projectId: testProject.id,
      name: 'Original Session',
      mode: 'plan',
      thinkingEnabled: true,
      model: 'claude-sonnet-4-20250514'
    });

    const duplicate = sessions.duplicate(original.id);

    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.name).toBe('Original Session (Copy)');
    expect(duplicate.mode).toBe('plan');
    expect(duplicate.thinkingEnabled).toBe(true);
    expect(duplicate.model).toBe('claude-sonnet-4-20250514');
    expect(duplicate.projectId).toBe(original.projectId);
  });

  it('should reset status to waiting', () => {
    const original = sessions.create({ ... });
    sessions.update(original.id, { status: 'completed' });

    const duplicate = sessions.duplicate(original.id);

    expect(duplicate.status).toBe('waiting');
  });

  it('should preserve token counts and cost', () => {
    const original = sessions.create({ ... });
    sessions.update(original.id, {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 200,
      cacheCreationInputTokens: 100,
      webSearchRequests: 3,
      costUsd: 0.05
    });

    const duplicate = sessions.duplicate(original.id);

    expect(duplicate.inputTokens).toBe(1000);
    expect(duplicate.outputTokens).toBe(500);
    expect(duplicate.cacheReadInputTokens).toBe(200);
    expect(duplicate.cacheCreationInputTokens).toBe(100);
    expect(duplicate.webSearchRequests).toBe(3);
    expect(duplicate.costUsd).toBe(0.05);
  });

  it('should copy gitBranch but not gitWorktree', () => {
    const original = sessions.create({
      projectId: testProject.id,
      gitBranch: 'feature-branch'
    });
    sessions.update(original.id, {
      gitWorktree: '/path/.worktrees/original-id'
    });

    const duplicate = sessions.duplicate(original.id);

    expect(duplicate.gitBranch).toBe('feature-branch');
    expect(duplicate.gitWorktree).toBeNull();
  });

  it('should allow custom name override', () => {
    const original = sessions.create({ name: 'Original' });

    const duplicate = sessions.duplicate(original.id, {
      name: 'My Custom Name'
    });

    expect(duplicate.name).toBe('My Custom Name');
  });

  it('should throw error for non-existent session', () => {
    expect(() => sessions.duplicate('non-existent-id'))
      .toThrow('Session not found');
  });

  it('should generate new timestamps', () => {
    const original = sessions.create({ ... });
    // Wait a bit to ensure different timestamp
    const duplicate = sessions.duplicate(original.id);

    expect(duplicate.createdAt).toBeGreaterThan(original.createdAt);
  });

  it('should not copy error, prUrl, or claudeSessionId', () => {
    const original = sessions.create({ ... });
    sessions.update(original.id, {
      error: 'Some error',
      prUrl: 'https://github.com/pr/123',
      claudeSessionId: 'claude-session-xyz'
    });

    const duplicate = sessions.duplicate(original.id);

    expect(duplicate.error).toBeNull();
    expect(duplicate.prUrl).toBeNull();
    expect(duplicate.claudeSessionId).toBeNull();
  });
});
```

---

### 2. Backend: ConversationRepository.duplicateForSession()

**File:** `packages/server/src/db/ConversationRepository.js`

```javascript
/**
 * Duplicates all conversations from one session to another.
 * @param {string} sourceSessionId - Source session ID
 * @param {string} targetSessionId - Target session ID
 * @returns {Map<string, string>} Mapping of old conversation IDs to new IDs
 */
duplicateForSession(sourceSessionId, targetSessionId) {
  const sourceConversations = this.findBySessionId(sourceSessionId);
  const idMapping = new Map();

  for (const conv of sourceConversations) {
    const newConv = this.create({
      sessionId: targetSessionId,
      name: conv.name,
      isActive: conv.isActive,
      summary: conv.summary  // Preserve existing summary
    });
    idMapping.set(conv.id, newConv.id);
  }

  return idMapping;
}
```

#### Tests for ConversationRepository.duplicateForSession()

**File:** `packages/server/src/db/ConversationRepository.test.js`

```javascript
describe('duplicateForSession()', () => {
  it('should copy all conversations to new session', () => {
    const conv1 = conversations.create({ sessionId: sourceSession.id, name: 'Initial' });
    const conv2 = conversations.create({ sessionId: sourceSession.id, name: 'Follow-up' });

    const mapping = conversations.duplicateForSession(
      sourceSession.id,
      targetSession.id
    );

    expect(mapping.size).toBe(2);
    const targetConvs = conversations.findBySessionId(targetSession.id);
    expect(targetConvs).toHaveLength(2);
    expect(targetConvs.map(c => c.name)).toContain('Initial');
    expect(targetConvs.map(c => c.name)).toContain('Follow-up');
  });

  it('should return correct ID mapping', () => {
    const conv = conversations.create({ sessionId: sourceSession.id, name: 'Test' });

    const mapping = conversations.duplicateForSession(
      sourceSession.id,
      targetSession.id
    );

    expect(mapping.has(conv.id)).toBe(true);
    const newId = mapping.get(conv.id);
    expect(newId).not.toBe(conv.id);
    expect(conversations.findById(newId)).toBeDefined();
  });

  it('should preserve isActive flag', () => {
    conversations.create({ sessionId: sourceSession.id, name: 'Inactive', isActive: false });
    conversations.create({ sessionId: sourceSession.id, name: 'Active', isActive: true });

    conversations.duplicateForSession(sourceSession.id, targetSession.id);

    const targetConvs = conversations.findBySessionId(targetSession.id);
    const active = targetConvs.find(c => c.name === 'Active');
    const inactive = targetConvs.find(c => c.name === 'Inactive');
    expect(active.isActive).toBe(true);
    expect(inactive.isActive).toBe(false);
  });

  it('should preserve conversation summaries', () => {
    const conv = conversations.create({ sessionId: sourceSession.id, name: 'Test' });
    conversations.update(conv.id, { summary: 'This is a summary' });

    const mapping = conversations.duplicateForSession(
      sourceSession.id,
      targetSession.id
    );

    const newConv = conversations.findById(mapping.get(conv.id));
    expect(newConv.summary).toBe('This is a summary');
  });

  it('should handle session with no conversations', () => {
    const mapping = conversations.duplicateForSession(
      emptySession.id,
      targetSession.id
    );

    expect(mapping.size).toBe(0);
    expect(conversations.findBySessionId(targetSession.id)).toHaveLength(0);
  });

  it('should generate new IDs for all conversations', () => {
    const conv1 = conversations.create({ sessionId: sourceSession.id });
    const conv2 = conversations.create({ sessionId: sourceSession.id });

    const mapping = conversations.duplicateForSession(
      sourceSession.id,
      targetSession.id
    );

    const newIds = Array.from(mapping.values());
    expect(newIds).not.toContain(conv1.id);
    expect(newIds).not.toContain(conv2.id);
  });
});
```

---

### 3. Backend: MessageRepository.duplicateForConversations()

**File:** `packages/server/src/db/MessageRepository.js`

```javascript
/**
 * Duplicates all messages from source conversations to target conversations.
 * @param {Map<string, string>} conversationIdMapping - Map of old conv IDs to new IDs
 * @param {string} targetSessionId - The new session ID for the messages
 */
duplicateForConversations(conversationIdMapping, targetSessionId) {
  for (const [sourceConvId, targetConvId] of conversationIdMapping) {
    const messages = this.findByConversationId(sourceConvId);

    for (const msg of messages) {
      this.create({
        sessionId: targetSessionId,
        conversationId: targetConvId,
        role: msg.role,
        content: msg.content,
        thinkingContent: msg.thinkingContent,
        // Preserve order via createdAt or explicit ordering
      });
    }
  }
}
```

#### Tests for MessageRepository.duplicateForConversations()

**File:** `packages/server/src/db/MessageRepository.test.js`

```javascript
describe('duplicateForConversations()', () => {
  it('should copy all messages to new conversations', () => {
    messages.create({ conversationId: sourceConv.id, sessionId: sourceSession.id, role: 'user', content: 'Hello' });
    messages.create({ conversationId: sourceConv.id, sessionId: sourceSession.id, role: 'assistant', content: 'Hi!' });

    const mapping = new Map([[sourceConv.id, targetConv.id]]);
    messages.duplicateForConversations(mapping, targetSession.id);

    const targetMsgs = messages.findByConversationId(targetConv.id);
    expect(targetMsgs).toHaveLength(2);
    expect(targetMsgs[0].content).toBe('Hello');
    expect(targetMsgs[1].content).toBe('Hi!');
  });

  it('should preserve message roles', () => {
    messages.create({ conversationId: sourceConv.id, sessionId: sourceSession.id, role: 'user', content: 'Q' });
    messages.create({ conversationId: sourceConv.id, sessionId: sourceSession.id, role: 'assistant', content: 'A' });
    messages.create({ conversationId: sourceConv.id, sessionId: sourceSession.id, role: 'system', content: 'S' });

    const mapping = new Map([[sourceConv.id, targetConv.id]]);
    messages.duplicateForConversations(mapping, targetSession.id);

    const targetMsgs = messages.findByConversationId(targetConv.id);
    expect(targetMsgs.map(m => m.role)).toEqual(['user', 'assistant', 'system']);
  });

  it('should copy thinkingContent when present', () => {
    messages.create({
      conversationId: sourceConv.id,
      sessionId: sourceSession.id,
      role: 'assistant',
      content: 'Response',
      thinkingContent: 'Internal reasoning...'
    });

    const mapping = new Map([[sourceConv.id, targetConv.id]]);
    messages.duplicateForConversations(mapping, targetSession.id);

    const targetMsgs = messages.findByConversationId(targetConv.id);
    expect(targetMsgs[0].thinkingContent).toBe('Internal reasoning...');
  });

  it('should preserve message order', () => {
    messages.create({ conversationId: sourceConv.id, sessionId: sourceSession.id, role: 'user', content: 'First' });
    messages.create({ conversationId: sourceConv.id, sessionId: sourceSession.id, role: 'assistant', content: 'Second' });
    messages.create({ conversationId: sourceConv.id, sessionId: sourceSession.id, role: 'user', content: 'Third' });

    const mapping = new Map([[sourceConv.id, targetConv.id]]);
    messages.duplicateForConversations(mapping, targetSession.id);

    const targetMsgs = messages.findByConversationId(targetConv.id);
    expect(targetMsgs.map(m => m.content)).toEqual(['First', 'Second', 'Third']);
  });

  it('should handle multiple conversations', () => {
    messages.create({ conversationId: sourceConv1.id, sessionId: sourceSession.id, content: 'Conv1 Msg' });
    messages.create({ conversationId: sourceConv2.id, sessionId: sourceSession.id, content: 'Conv2 Msg' });

    const mapping = new Map([
      [sourceConv1.id, targetConv1.id],
      [sourceConv2.id, targetConv2.id]
    ]);
    messages.duplicateForConversations(mapping, targetSession.id);

    expect(messages.findByConversationId(targetConv1.id)[0].content).toBe('Conv1 Msg');
    expect(messages.findByConversationId(targetConv2.id)[0].content).toBe('Conv2 Msg');
  });

  it('should assign new session ID to all messages', () => {
    messages.create({ conversationId: sourceConv.id, sessionId: sourceSession.id, content: 'Test' });

    const mapping = new Map([[sourceConv.id, targetConv.id]]);
    messages.duplicateForConversations(mapping, targetSession.id);

    const targetMsgs = messages.findByConversationId(targetConv.id);
    expect(targetMsgs[0].sessionId).toBe(targetSession.id);
  });

  it('should generate new message IDs', () => {
    const originalMsg = messages.create({ conversationId: sourceConv.id, sessionId: sourceSession.id, content: 'Test' });

    const mapping = new Map([[sourceConv.id, targetConv.id]]);
    messages.duplicateForConversations(mapping, targetSession.id);

    const targetMsgs = messages.findByConversationId(targetConv.id);
    expect(targetMsgs[0].id).not.toBe(originalMsg.id);
  });
});
```

---

### 4. Backend: CanvasItemRepository.duplicateForSession()

**File:** `packages/server/src/db/CanvasItemRepository.js`

```javascript
/**
 * Duplicates all canvas items from one session to another.
 * @param {string} sourceSessionId - Source session ID
 * @param {string} targetSessionId - Target session ID
 */
duplicateForSession(sourceSessionId, targetSessionId) {
  const items = this.findBySessionId(sourceSessionId);

  for (const item of items) {
    this.create({
      sessionId: targetSessionId,
      type: item.type,
      content: item.content,
      data: item.data,
      mimeType: item.mimeType,
      filename: item.filename,
      label: item.label,
      width: item.width,
      height: item.height
    });
  }
}
```

#### Tests for CanvasItemRepository.duplicateForSession()

**File:** `packages/server/src/db/CanvasItemRepository.test.js`

```javascript
describe('duplicateForSession()', () => {
  it('should copy all canvas items to new session', () => {
    canvasItems.create({ sessionId: sourceSession.id, type: 'image', filename: 'pic.png' });
    canvasItems.create({ sessionId: sourceSession.id, type: 'markdown', content: '# Title' });

    canvasItems.duplicateForSession(sourceSession.id, targetSession.id);

    const targetItems = canvasItems.findBySessionId(targetSession.id);
    expect(targetItems).toHaveLength(2);
  });

  it('should preserve all item metadata', () => {
    canvasItems.create({
      sessionId: sourceSession.id,
      type: 'image',
      content: 'base64data',
      mimeType: 'image/png',
      filename: 'screenshot.png',
      label: 'UI Screenshot',
      width: 1920,
      height: 1080
    });

    canvasItems.duplicateForSession(sourceSession.id, targetSession.id);

    const targetItems = canvasItems.findBySessionId(targetSession.id);
    expect(targetItems[0]).toMatchObject({
      type: 'image',
      content: 'base64data',
      mimeType: 'image/png',
      filename: 'screenshot.png',
      label: 'UI Screenshot',
      width: 1920,
      height: 1080
    });
  });

  it('should handle all canvas item types', () => {
    const types = ['image', 'markdown', 'text', 'json', 'pdf', 'code'];
    types.forEach(type => {
      canvasItems.create({ sessionId: sourceSession.id, type, filename: `file.${type}` });
    });

    canvasItems.duplicateForSession(sourceSession.id, targetSession.id);

    const targetItems = canvasItems.findBySessionId(targetSession.id);
    expect(targetItems).toHaveLength(types.length);
    expect(targetItems.map(i => i.type).sort()).toEqual(types.sort());
  });

  it('should generate new IDs for all items', () => {
    const original = canvasItems.create({ sessionId: sourceSession.id, type: 'text' });

    canvasItems.duplicateForSession(sourceSession.id, targetSession.id);

    const targetItems = canvasItems.findBySessionId(targetSession.id);
    expect(targetItems[0].id).not.toBe(original.id);
  });

  it('should handle session with no canvas items', () => {
    canvasItems.duplicateForSession(emptySession.id, targetSession.id);

    expect(canvasItems.findBySessionId(targetSession.id)).toHaveLength(0);
  });

  it('should preserve JSON data field', () => {
    canvasItems.create({
      sessionId: sourceSession.id,
      type: 'json',
      data: { key: 'value', nested: { a: 1 } }
    });

    canvasItems.duplicateForSession(sourceSession.id, targetSession.id);

    const targetItems = canvasItems.findBySessionId(targetSession.id);
    expect(targetItems[0].data).toEqual({ key: 'value', nested: { a: 1 } });
  });
});
```

---

### 5. Backend: SessionNoteRepository.duplicateForSession()

**File:** `packages/server/src/db/SessionNoteRepository.js`

```javascript
/**
 * Duplicates all notes from one session to another.
 * @param {string} sourceSessionId - Source session ID
 * @param {string} targetSessionId - Target session ID
 */
duplicateForSession(sourceSessionId, targetSessionId) {
  const notes = this.findBySessionId(sourceSessionId);

  for (const note of notes) {
    this.create({
      sessionId: targetSessionId,
      content: note.content
    });
  }
}
```

#### Tests for SessionNoteRepository.duplicateForSession()

**File:** `packages/server/src/db/SessionNoteRepository.test.js`

```javascript
describe('duplicateForSession()', () => {
  it('should copy all notes to new session', () => {
    sessionNotes.create({ sessionId: sourceSession.id, content: 'Note 1' });
    sessionNotes.create({ sessionId: sourceSession.id, content: 'Note 2' });

    sessionNotes.duplicateForSession(sourceSession.id, targetSession.id);

    const targetNotes = sessionNotes.findBySessionId(targetSession.id);
    expect(targetNotes).toHaveLength(2);
    expect(targetNotes.map(n => n.content)).toContain('Note 1');
    expect(targetNotes.map(n => n.content)).toContain('Note 2');
  });

  it('should preserve note content exactly', () => {
    const content = '# Markdown Note\n\nWith **formatting** and `code`';
    sessionNotes.create({ sessionId: sourceSession.id, content });

    sessionNotes.duplicateForSession(sourceSession.id, targetSession.id);

    const targetNotes = sessionNotes.findBySessionId(targetSession.id);
    expect(targetNotes[0].content).toBe(content);
  });

  it('should generate new IDs for all notes', () => {
    const original = sessionNotes.create({ sessionId: sourceSession.id, content: 'Test' });

    sessionNotes.duplicateForSession(sourceSession.id, targetSession.id);

    const targetNotes = sessionNotes.findBySessionId(targetSession.id);
    expect(targetNotes[0].id).not.toBe(original.id);
  });

  it('should handle session with no notes', () => {
    sessionNotes.duplicateForSession(emptySession.id, targetSession.id);

    expect(sessionNotes.findBySessionId(targetSession.id)).toHaveLength(0);
  });
});
```

---

### 6. Backend: SessionSummaryRepository.duplicateForSession()

**File:** `packages/server/src/db/SessionSummaryRepository.js`

```javascript
/**
 * Duplicates the session summary from one session to another.
 * @param {string} sourceSessionId - Source session ID
 * @param {string} targetSessionId - Target session ID
 */
duplicateForSession(sourceSessionId, targetSessionId) {
  const summary = this.findBySessionId(sourceSessionId);

  if (summary) {
    this.create({
      sessionId: targetSessionId,
      content: summary.content
    });
  }
}
```

#### Tests for SessionSummaryRepository.duplicateForSession()

**File:** `packages/server/src/db/SessionSummaryRepository.test.js`

```javascript
describe('duplicateForSession()', () => {
  it('should copy session summary to new session', () => {
    sessionSummaries.create({ sessionId: sourceSession.id, content: 'This session implemented feature X' });

    sessionSummaries.duplicateForSession(sourceSession.id, targetSession.id);

    const targetSummary = sessionSummaries.findBySessionId(targetSession.id);
    expect(targetSummary).not.toBeNull();
    expect(targetSummary.content).toBe('This session implemented feature X');
  });

  it('should preserve summary content exactly', () => {
    const content = '## Summary\n\n- Implemented **feature X**\n- Fixed `bug Y`';
    sessionSummaries.create({ sessionId: sourceSession.id, content });

    sessionSummaries.duplicateForSession(sourceSession.id, targetSession.id);

    const targetSummary = sessionSummaries.findBySessionId(targetSession.id);
    expect(targetSummary.content).toBe(content);
  });

  it('should generate new ID for the summary', () => {
    const original = sessionSummaries.create({ sessionId: sourceSession.id, content: 'Summary' });

    sessionSummaries.duplicateForSession(sourceSession.id, targetSession.id);

    const targetSummary = sessionSummaries.findBySessionId(targetSession.id);
    expect(targetSummary.id).not.toBe(original.id);
  });

  it('should handle session with no summary', () => {
    sessionSummaries.duplicateForSession(emptySession.id, targetSession.id);

    expect(sessionSummaries.findBySessionId(targetSession.id)).toBeNull();
  });
});
```

---

### 7. Backend: Session Duplicator Service (Orchestration)

**File:** `packages/server/src/services/sessionDuplicator.js` (NEW FILE)

This service orchestrates the entire duplication process, including git setup:

```javascript
import { sessions, conversations, messages, canvasItems, sessionNotes, sessionSummaries, projects } from '../db/index.js';
import { setupGitForSession } from './gitSessionSetup.js';

/**
 * Duplicates a session including all related data.
 * Handles git setup based on the source session's configuration.
 *
 * @param {string} sourceSessionId - ID of session to duplicate
 * @param {object} options - Duplication options
 * @param {string} [options.name] - Custom name for new session
 * @param {string} [options.gitMode] - Override git mode ('worktree', 'branch', or null)
 * @param {string} [options.gitBranch] - Override git branch name
 * @returns {Promise<object>} The new session with all data duplicated
 */
export async function duplicateSession(sourceSessionId, options = {}) {
  // 1. Get source session and project
  const sourceSession = sessions.findById(sourceSessionId);
  if (!sourceSession) {
    throw new Error(`Session not found: ${sourceSessionId}`);
  }

  const project = projects.findById(sourceSession.projectId);
  if (!project) {
    throw new Error(`Project not found: ${sourceSession.projectId}`);
  }

  // 2. Infer git mode from source session
  const sourceGitMode = sourceSession.gitWorktree ? 'worktree'
                      : sourceSession.gitBranch ? 'branch'
                      : null;

  // 3. Determine git settings for new session
  const gitMode = options.gitMode !== undefined ? options.gitMode : sourceGitMode;
  const gitBranch = options.gitBranch !== undefined ? options.gitBranch : sourceSession.gitBranch;

  // 4. Duplicate session record (without git worktree)
  const newSession = sessions.duplicate(sourceSessionId, {
    name: options.name
  });

  try {
    // 5. Duplicate conversations and get ID mapping
    const conversationMapping = conversations.duplicateForSession(
      sourceSessionId,
      newSession.id
    );

    // 6. Duplicate messages using conversation mapping
    messages.duplicateForConversations(conversationMapping, newSession.id);

    // 7. Duplicate canvas items
    canvasItems.duplicateForSession(sourceSessionId, newSession.id);

    // 8. Duplicate session notes
    sessionNotes.duplicateForSession(sourceSessionId, newSession.id);

    // 9. Duplicate session summary (if exists)
    sessionSummaries.duplicateForSession(sourceSessionId, newSession.id);

    // 10. Setup git environment for new session
    if (gitMode) {
      const { gitWorktree } = await setupGitForSession({
        projectDir: project.workingDirectory,
        gitMode,
        gitBranch,
        sessionId: newSession.id
      });

      // 11. Update session with worktree path if created
      if (gitWorktree) {
        sessions.update(newSession.id, { gitWorktree });
      }
    }

    // Return the updated session
    return sessions.findById(newSession.id);

  } catch (error) {
    // Cleanup: delete the new session if duplication fails
    sessions.delete(newSession.id);
    throw error;
  }
}
```

#### Tests for sessionDuplicator.duplicateSession()

**File:** `packages/server/src/services/sessionDuplicator.test.js` (NEW FILE)

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { duplicateSession } from './sessionDuplicator.js';
import { sessions, conversations, messages, canvasItems, sessionNotes, projects } from '../db/index.js';
import * as gitSessionSetup from './gitSessionSetup.js';

// Mock gitSessionSetup to avoid actual git operations in tests
vi.mock('./gitSessionSetup.js');

describe('duplicateSession()', () => {
  let testProject;
  let sourceSession;

  beforeEach(() => {
    testProject = projects.create({ name: 'Test', workingDirectory: '/tmp/test' });
    sourceSession = sessions.create({
      projectId: testProject.id,
      name: 'Source Session',
      mode: 'standard'
    });

    // Default mock behavior
    gitSessionSetup.setupGitForSession.mockResolvedValue({
      workingDirectory: '/tmp/test',
      gitWorktree: null
    });
  });

  describe('session duplication', () => {
    it('should create a new session with copied settings', async () => {
      const newSession = await duplicateSession(sourceSession.id);

      expect(newSession.id).not.toBe(sourceSession.id);
      expect(newSession.name).toBe('Source Session (Copy)');
      expect(newSession.mode).toBe('standard');
      expect(newSession.projectId).toBe(testProject.id);
    });

    it('should allow custom name', async () => {
      const newSession = await duplicateSession(sourceSession.id, {
        name: 'My Custom Name'
      });

      expect(newSession.name).toBe('My Custom Name');
    });

    it('should throw for non-existent session', async () => {
      await expect(duplicateSession('non-existent'))
        .rejects.toThrow('Session not found');
    });
  });

  describe('conversation duplication', () => {
    it('should copy all conversations with messages', async () => {
      const conv = conversations.create({ sessionId: sourceSession.id, name: 'Chat' });
      messages.create({ sessionId: sourceSession.id, conversationId: conv.id, role: 'user', content: 'Hello' });
      messages.create({ sessionId: sourceSession.id, conversationId: conv.id, role: 'assistant', content: 'Hi!' });

      const newSession = await duplicateSession(sourceSession.id);

      const newConvs = conversations.findBySessionId(newSession.id);
      expect(newConvs).toHaveLength(1);
      expect(newConvs[0].name).toBe('Chat');

      const newMsgs = messages.findByConversationId(newConvs[0].id);
      expect(newMsgs).toHaveLength(2);
      expect(newMsgs[0].content).toBe('Hello');
      expect(newMsgs[1].content).toBe('Hi!');
    });
  });

  describe('canvas items duplication', () => {
    it('should copy all canvas items', async () => {
      canvasItems.create({ sessionId: sourceSession.id, type: 'image', filename: 'test.png' });
      canvasItems.create({ sessionId: sourceSession.id, type: 'markdown', content: '# Doc' });

      const newSession = await duplicateSession(sourceSession.id);

      const newItems = canvasItems.findBySessionId(newSession.id);
      expect(newItems).toHaveLength(2);
    });
  });

  describe('notes duplication', () => {
    it('should copy all session notes', async () => {
      sessionNotes.create({ sessionId: sourceSession.id, content: 'Important note' });

      const newSession = await duplicateSession(sourceSession.id);

      const newNotes = sessionNotes.findBySessionId(newSession.id);
      expect(newNotes).toHaveLength(1);
      expect(newNotes[0].content).toBe('Important note');
    });
  });

  describe('session summary duplication', () => {
    it('should copy session summary', async () => {
      sessionSummaries.create({ sessionId: sourceSession.id, content: 'This session did X and Y' });

      const newSession = await duplicateSession(sourceSession.id);

      const newSummary = sessionSummaries.findBySessionId(newSession.id);
      expect(newSummary).not.toBeNull();
      expect(newSummary.content).toBe('This session did X and Y');
    });

    it('should handle session with no summary', async () => {
      const newSession = await duplicateSession(sourceSession.id);

      const newSummary = sessionSummaries.findBySessionId(newSession.id);
      expect(newSummary).toBeNull();
    });
  });

  describe('git mode: none', () => {
    it('should not call setupGitForSession when source has no git', async () => {
      // Source has no git setup (gitBranch: null, gitWorktree: null)
      await duplicateSession(sourceSession.id);

      expect(gitSessionSetup.setupGitForSession).not.toHaveBeenCalled();
    });
  });

  describe('git mode: branch', () => {
    beforeEach(() => {
      sessions.update(sourceSession.id, { gitBranch: 'feature-x' });
    });

    it('should call setupGitForSession with branch mode', async () => {
      await duplicateSession(sourceSession.id);

      expect(gitSessionSetup.setupGitForSession).toHaveBeenCalledWith({
        projectDir: testProject.workingDirectory,
        gitMode: 'branch',
        gitBranch: 'feature-x',
        sessionId: expect.any(String)
      });
    });

    it('should allow overriding git branch', async () => {
      await duplicateSession(sourceSession.id, { gitBranch: 'new-branch' });

      expect(gitSessionSetup.setupGitForSession).toHaveBeenCalledWith(
        expect.objectContaining({ gitBranch: 'new-branch' })
      );
    });
  });

  describe('git mode: worktree', () => {
    beforeEach(() => {
      sessions.update(sourceSession.id, {
        gitBranch: 'feature-y',
        gitWorktree: '/tmp/test/.worktrees/source-session-id'
      });

      gitSessionSetup.setupGitForSession.mockResolvedValue({
        workingDirectory: '/tmp/test/.worktrees/new-session-id',
        gitWorktree: '/tmp/test/.worktrees/new-session-id'
      });
    });

    it('should call setupGitForSession with worktree mode', async () => {
      await duplicateSession(sourceSession.id);

      expect(gitSessionSetup.setupGitForSession).toHaveBeenCalledWith({
        projectDir: testProject.workingDirectory,
        gitMode: 'worktree',
        gitBranch: 'feature-y',
        sessionId: expect.any(String)
      });
    });

    it('should update session with new worktree path', async () => {
      const newSession = await duplicateSession(sourceSession.id);

      expect(newSession.gitWorktree).toBe('/tmp/test/.worktrees/new-session-id');
      expect(newSession.gitWorktree).not.toBe(sourceSession.gitWorktree);
    });

    it('should create worktree with new session ID (different path)', async () => {
      const newSession = await duplicateSession(sourceSession.id);

      const callArgs = gitSessionSetup.setupGitForSession.mock.calls[0][0];
      expect(callArgs.sessionId).toBe(newSession.id);
      expect(callArgs.sessionId).not.toBe(sourceSession.id);
    });
  });

  describe('git mode override', () => {
    it('should allow changing from worktree to branch mode', async () => {
      sessions.update(sourceSession.id, {
        gitBranch: 'feature',
        gitWorktree: '/tmp/test/.worktrees/source-id'
      });

      await duplicateSession(sourceSession.id, { gitMode: 'branch' });

      expect(gitSessionSetup.setupGitForSession).toHaveBeenCalledWith(
        expect.objectContaining({ gitMode: 'branch' })
      );
    });

    it('should allow disabling git for duplicate', async () => {
      sessions.update(sourceSession.id, { gitBranch: 'feature' });

      await duplicateSession(sourceSession.id, { gitMode: null });

      expect(gitSessionSetup.setupGitForSession).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should cleanup new session if git setup fails', async () => {
      sessions.update(sourceSession.id, { gitBranch: 'feature' });
      gitSessionSetup.setupGitForSession.mockRejectedValue(new Error('Git error'));

      const sessionCountBefore = sessions.findAll().length;

      await expect(duplicateSession(sourceSession.id)).rejects.toThrow('Git error');

      const sessionCountAfter = sessions.findAll().length;
      expect(sessionCountAfter).toBe(sessionCountBefore);
    });

    it('should not leave orphaned data if duplication fails', async () => {
      sessions.update(sourceSession.id, { gitBranch: 'feature' });
      canvasItems.create({ sessionId: sourceSession.id, type: 'text' });
      gitSessionSetup.setupGitForSession.mockRejectedValue(new Error('Git error'));

      await expect(duplicateSession(sourceSession.id)).rejects.toThrow();

      // Due to cascade delete, all related data should be cleaned up
      const allSessions = sessions.findAll();
      expect(allSessions.map(s => s.id)).not.toContain(expect.any(String));
    });
  });
});
```

---

### 7. Backend: API Endpoint

**File:** `packages/server/src/api/sessions.js`

Add the duplicate endpoint:

```javascript
import { duplicateSession } from '../services/sessionDuplicator.js';

/**
 * POST /api/sessions/:id/duplicate
 * Duplicates a session including all conversations, messages, canvas items, and notes.
 * Handles git setup based on source session configuration.
 */
router.post('/:id/duplicate', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, gitMode, gitBranch } = req.body;

    const newSession = await duplicateSession(id, { name, gitMode, gitBranch });

    // Broadcast to WebSocket clients
    wsManager.broadcastToProject(newSession.projectId, {
      type: 'sessionCreated',
      session: newSession
    });

    res.status(201).json(newSession);
  } catch (error) {
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      console.error('Failed to duplicate session:', error);
      res.status(500).json({ error: error.message });
    }
  }
});
```

#### Tests for API Endpoint

**File:** `packages/server/src/api/sessions.test.js`

```javascript
describe('POST /api/sessions/:id/duplicate', () => {
  let testSession;

  beforeEach(() => {
    testSession = sessions.create({
      projectId: testProject.id,
      name: 'Test Session'
    });
  });

  it('should return 201 with new session', async () => {
    const response = await request(app)
      .post(`/api/sessions/${testSession.id}/duplicate`)
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.id).not.toBe(testSession.id);
    expect(response.body.name).toBe('Test Session (Copy)');
  });

  it('should accept custom name', async () => {
    const response = await request(app)
      .post(`/api/sessions/${testSession.id}/duplicate`)
      .send({ name: 'Custom Name' });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe('Custom Name');
  });

  it('should return 404 for non-existent session', async () => {
    const response = await request(app)
      .post('/api/sessions/non-existent/duplicate')
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.error).toContain('not found');
  });

  it('should accept gitMode override', async () => {
    sessions.update(testSession.id, { gitBranch: 'feature' });

    const response = await request(app)
      .post(`/api/sessions/${testSession.id}/duplicate`)
      .send({ gitMode: null });

    expect(response.status).toBe(201);
    expect(response.body.gitBranch).toBeNull();
  });

  it('should accept gitBranch override', async () => {
    sessions.update(testSession.id, { gitBranch: 'old-branch' });

    const response = await request(app)
      .post(`/api/sessions/${testSession.id}/duplicate`)
      .send({ gitBranch: 'new-branch' });

    expect(response.status).toBe(201);
    expect(response.body.gitBranch).toBe('new-branch');
  });

  it('should broadcast WebSocket event', async () => {
    const wsMessages = [];
    wsManager.broadcastToProject = vi.fn((projectId, msg) => wsMessages.push(msg));

    await request(app)
      .post(`/api/sessions/${testSession.id}/duplicate`)
      .send({});

    expect(wsMessages).toContainEqual(
      expect.objectContaining({ type: 'sessionCreated' })
    );
  });

  it('should return 500 on internal error', async () => {
    // Force an error by corrupting the session
    vi.spyOn(sessions, 'findById').mockImplementationOnce(() => {
      throw new Error('Database error');
    });

    const response = await request(app)
      .post(`/api/sessions/${testSession.id}/duplicate`)
      .send({});

    expect(response.status).toBe(500);
  });
});
```

---

### 8. Frontend: API Client

**File:** `packages/web/src/api/ApiClient.js`

```javascript
/**
 * Duplicates a session with all its data.
 * @param {string} sessionId - ID of session to duplicate
 * @param {object} options - Duplication options
 * @param {string} [options.name] - Custom name for new session
 * @param {string} [options.gitMode] - Git mode override
 * @param {string} [options.gitBranch] - Git branch override
 * @returns {Promise<object>} The new session
 */
async duplicateSession(sessionId, { name, gitMode, gitBranch } = {}) {
  return this.#request('POST', `/sessions/${sessionId}/duplicate`, {
    name,
    gitMode,
    gitBranch
  });
}
```

#### Tests for API Client

**File:** `packages/web/src/api/ApiClient.test.js`

```javascript
describe('duplicateSession()', () => {
  it('should call POST /sessions/:id/duplicate', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: 'new-session' }));

    await api.duplicateSession('session-123');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/sessions/session-123/duplicate'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should pass name in request body', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: 'new-session' }));

    await api.duplicateSession('session-123', { name: 'Custom' });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual(
      expect.objectContaining({ name: 'Custom' })
    );
  });

  it('should pass gitMode and gitBranch options', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: 'new-session' }));

    await api.duplicateSession('session-123', {
      gitMode: 'worktree',
      gitBranch: 'feature'
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual(
      expect.objectContaining({ gitMode: 'worktree', gitBranch: 'feature' })
    );
  });

  it('should return the new session', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({
      id: 'new-session',
      name: 'Copy'
    }));

    const result = await api.duplicateSession('session-123');

    expect(result).toEqual({ id: 'new-session', name: 'Copy' });
  });
});
```

---

### 9. Frontend: Store Action

**File:** `packages/web/src/stores/sessions.js`

```javascript
/**
 * Duplicates a session and adds it to the store.
 * @param {string} sessionId - ID of session to duplicate
 * @param {object} options - Duplication options
 * @returns {Promise<object>} The new session
 */
async duplicateSession(sessionId, options = {}) {
  this.loading = true;
  try {
    const newSession = await api.duplicateSession(sessionId, options);
    this.sessions.unshift(newSession);  // Add to top of list
    return newSession;
  } finally {
    this.loading = false;
  }
}
```

#### Tests for Store Action

**File:** `packages/web/src/stores/sessions.test.js`

```javascript
describe('duplicateSession()', () => {
  it('should call API and add session to store', async () => {
    const newSession = { id: 'new-id', name: 'Copy' };
    api.duplicateSession.mockResolvedValue(newSession);

    const result = await store.duplicateSession('source-id');

    expect(api.duplicateSession).toHaveBeenCalledWith('source-id', {});
    expect(result).toEqual(newSession);
    expect(store.sessions[0]).toEqual(newSession);
  });

  it('should pass options to API', async () => {
    api.duplicateSession.mockResolvedValue({ id: 'new' });

    await store.duplicateSession('source-id', { name: 'Custom' });

    expect(api.duplicateSession).toHaveBeenCalledWith('source-id', { name: 'Custom' });
  });

  it('should set loading state during operation', async () => {
    let loadingDuringCall = false;
    api.duplicateSession.mockImplementation(async () => {
      loadingDuringCall = store.loading;
      return { id: 'new' };
    });

    await store.duplicateSession('source-id');

    expect(loadingDuringCall).toBe(true);
    expect(store.loading).toBe(false);
  });

  it('should reset loading on error', async () => {
    api.duplicateSession.mockRejectedValue(new Error('Failed'));

    await expect(store.duplicateSession('source-id')).rejects.toThrow();

    expect(store.loading).toBe(false);
  });

  it('should add new session at beginning of list', async () => {
    store.sessions = [{ id: 'existing' }];
    api.duplicateSession.mockResolvedValue({ id: 'new' });

    await store.duplicateSession('source-id');

    expect(store.sessions[0].id).toBe('new');
    expect(store.sessions[1].id).toBe('existing');
  });
});
```

---

### 10. Frontend: UI Component

**File:** `packages/web/src/components/ConversationTab.vue`

Add a "Duplicate Session" button in the conversation tab header:

```vue
<template>
  <div class="flex items-center gap-2">
    <!-- Existing header content -->

    <!-- Duplicate Button -->
    <button
      @click="handleDuplicate"
      class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg
             flex items-center gap-2 transition-colors disabled:opacity-50
             disabled:cursor-not-allowed"
      :disabled="duplicating"
      title="Duplicate this session with all conversations and canvas items"
    >
      <DocumentDuplicateIcon class="w-4 h-4" />
      <span>{{ duplicating ? 'Duplicating...' : 'Duplicate' }}</span>
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionsStore } from '@/stores/sessions';
import { useUiStore } from '@/stores/ui';
import { DocumentDuplicateIcon } from '@heroicons/vue/24/outline';

const props = defineProps({
  session: { type: Object, required: true }
});

const router = useRouter();
const sessionsStore = useSessionsStore();
const uiStore = useUiStore();

const duplicating = ref(false);

async function handleDuplicate() {
  duplicating.value = true;
  try {
    const newSession = await sessionsStore.duplicateSession(props.session.id);
    uiStore.showToast('Session duplicated successfully', 'success');
    // Navigate to the new session
    router.push(`/sessions/${newSession.id}`);
  } catch (error) {
    console.error('Failed to duplicate session:', error);
    uiStore.showToast('Failed to duplicate session', 'error');
  } finally {
    duplicating.value = false;
  }
}
</script>
```

#### Tests for UI Component

**File:** `packages/web/src/components/ConversationTab.test.js`

```javascript
describe('Duplicate button', () => {
  it('should render duplicate button', () => {
    const wrapper = mount(ConversationTab, {
      props: { session: mockSession }
    });

    expect(wrapper.find('button[title*="Duplicate"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Duplicate');
  });

  it('should call duplicateSession on click', async () => {
    const wrapper = mount(ConversationTab, {
      props: { session: mockSession }
    });

    await wrapper.find('button[title*="Duplicate"]').trigger('click');

    expect(sessionsStore.duplicateSession).toHaveBeenCalledWith(mockSession.id);
  });

  it('should show loading state while duplicating', async () => {
    sessionsStore.duplicateSession.mockImplementation(() => new Promise(() => {}));
    const wrapper = mount(ConversationTab, {
      props: { session: mockSession }
    });

    await wrapper.find('button[title*="Duplicate"]').trigger('click');

    expect(wrapper.text()).toContain('Duplicating...');
    expect(wrapper.find('button[title*="Duplicate"]').attributes('disabled')).toBeDefined();
  });

  it('should show success toast on completion', async () => {
    sessionsStore.duplicateSession.mockResolvedValue({ id: 'new-id' });
    const wrapper = mount(ConversationTab, {
      props: { session: mockSession }
    });

    await wrapper.find('button[title*="Duplicate"]').trigger('click');
    await flushPromises();

    expect(uiStore.showToast).toHaveBeenCalledWith(
      'Session duplicated successfully',
      'success'
    );
  });

  it('should show error toast on failure', async () => {
    sessionsStore.duplicateSession.mockRejectedValue(new Error('Failed'));
    const wrapper = mount(ConversationTab, {
      props: { session: mockSession }
    });

    await wrapper.find('button[title*="Duplicate"]').trigger('click');
    await flushPromises();

    expect(uiStore.showToast).toHaveBeenCalledWith(
      'Failed to duplicate session',
      'error'
    );
  });

  it('should navigate to new session after duplication', async () => {
    sessionsStore.duplicateSession.mockResolvedValue({ id: 'new-session-id' });
    const wrapper = mount(ConversationTab, {
      props: { session: mockSession }
    });

    await wrapper.find('button[title*="Duplicate"]').trigger('click');
    await flushPromises();

    expect(router.push).toHaveBeenCalledWith('/sessions/new-session-id');
  });

  it('should reset button state after error', async () => {
    sessionsStore.duplicateSession.mockRejectedValue(new Error('Failed'));
    const wrapper = mount(ConversationTab, {
      props: { session: mockSession }
    });

    await wrapper.find('button[title*="Duplicate"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Duplicate');
    expect(wrapper.find('button[title*="Duplicate"]').attributes('disabled')).toBeUndefined();
  });
});
```

---

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `packages/server/src/db/SessionRepository.js` | Modify | Add `duplicate()` method |
| `packages/server/src/db/SessionRepository.test.js` | Modify | Add tests for duplicate |
| `packages/server/src/db/ConversationRepository.js` | Modify | Add `duplicateForSession()` |
| `packages/server/src/db/ConversationRepository.test.js` | Modify | Add tests for duplicateForSession |
| `packages/server/src/db/MessageRepository.js` | Modify | Add `duplicateForConversations()` |
| `packages/server/src/db/MessageRepository.test.js` | Modify | Add tests for duplicateForConversations |
| `packages/server/src/db/CanvasItemRepository.js` | Modify | Add `duplicateForSession()` |
| `packages/server/src/db/CanvasItemRepository.test.js` | Modify | Add tests for duplicateForSession |
| `packages/server/src/db/SessionNoteRepository.js` | Modify | Add `duplicateForSession()` |
| `packages/server/src/db/SessionNoteRepository.test.js` | Modify | Add tests for duplicateForSession |
| `packages/server/src/db/SessionSummaryRepository.js` | Modify | Add `duplicateForSession()` |
| `packages/server/src/db/SessionSummaryRepository.test.js` | Modify | Add tests for duplicateForSession |
| `packages/server/src/services/sessionDuplicator.js` | **New** | Orchestration service |
| `packages/server/src/services/sessionDuplicator.test.js` | **New** | Service tests |
| `packages/server/src/api/sessions.js` | Modify | Add POST endpoint |
| `packages/server/src/api/sessions.test.js` | Modify | Add endpoint tests |
| `packages/web/src/api/ApiClient.js` | Modify | Add `duplicateSession()` |
| `packages/web/src/api/ApiClient.test.js` | Modify | Add API client tests |
| `packages/web/src/stores/sessions.js` | Modify | Add store action |
| `packages/web/src/stores/sessions.test.js` | Modify | Add store tests |
| `packages/web/src/components/ConversationTab.vue` | Modify | Add UI button |
| `packages/web/src/components/ConversationTab.test.js` | Modify | Add component tests |

---

## Implementation Order

1. **Backend repositories** (1-6) - Add duplicate methods with tests
   - SessionRepository.duplicate()
   - ConversationRepository.duplicateForSession()
   - MessageRepository.duplicateForConversations()
   - CanvasItemRepository.duplicateForSession()
   - SessionNoteRepository.duplicateForSession()
   - SessionSummaryRepository.duplicateForSession()
2. **Backend service** (7) - Create sessionDuplicator with tests
3. **Backend API endpoint** (8) - Add POST route with tests
4. **Frontend API client** (9) - Add method with tests
5. **Frontend store** (10) - Add action with tests
6. **Frontend UI** (11) - Add button with tests
7. **Integration testing** - Manual E2E verification
8. **E2E tests** - Playwright tests for full flow

---

## E2E Test Plan

**File:** `tests/e2e/duplicate-session.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Duplicate Session', () => {
  test('should duplicate session from conversation tab', async ({ page }) => {
    // Navigate to existing session
    await page.goto('/sessions/test-session-id');

    // Click duplicate button
    await page.click('button:has-text("Duplicate")');

    // Wait for navigation to new session
    await expect(page).toHaveURL(/\/sessions\/(?!test-session-id)/);

    // Verify success toast
    await expect(page.locator('.toast')).toContainText('duplicated successfully');

    // Verify session name
    await expect(page.locator('h1')).toContainText('(Copy)');
  });

  test('should duplicate conversations and messages', async ({ page }) => {
    // Setup: create session with messages
    // Duplicate
    // Verify messages appear in new session
  });

  test('should duplicate canvas items', async ({ page }) => {
    // Setup: create session with canvas items
    // Duplicate
    // Switch to canvas tab
    // Verify items appear
  });

  test('should handle worktree sessions correctly', async ({ page }) => {
    // Setup: create session with worktree
    // Duplicate
    // Verify new worktree path is different
  });
});
```
