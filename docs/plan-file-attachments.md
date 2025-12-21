# Plan: File Attachments for Sessions and Messages

## Overview

Add the ability for users to attach files when:
1. Creating a new session (along with the initial prompt)
2. Sending follow-up messages in an existing conversation

## Current Architecture Summary

### Existing Patterns to Reuse

**Canvas File Upload** (`packages/server/src/api/canvas.js`):
- Uses `multer` with memory storage for file handling
- Accepts `FormData` with file + metadata
- Stores images as base64 in database
- Has drag-and-drop + file picker UI

**API Client** (`packages/web/src/api.js`):
- `uploadCanvasItem()` method shows FormData pattern
- Clean async/await fetch with proper error handling

### Key Files to Modify

| Layer | File | Purpose |
|-------|------|---------|
| Backend | `packages/server/src/api/projects.js` | Session creation endpoint |
| Backend | `packages/server/src/api/sessions.js` | Message sending endpoint |
| Backend | `packages/server/src/services/sessionManager.js` | Claude SDK integration |
| Shared | `packages/shared/src/contracts/sessions.js` | Request/response types |
| Frontend | `packages/web/src/views/NewSessionView.vue` | New session form |
| Frontend | `packages/web/src/components/ConversationTab.vue` | Follow-up message form |
| Frontend | `packages/web/src/api.js` | API client methods |
| Frontend | `packages/web/src/stores/sessions.js` | Store methods |
| Database | `packages/server/src/schema.sql` | Message attachments table |

---

## Implementation Plan

### Phase 1: Database Schema

Add a new table to store file attachments linked to messages:

```sql
CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES conversation_messages(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_type TEXT CHECK (storage_type IN ('base64', 'file_path', 'project_file')) DEFAULT 'base64',
  content TEXT,  -- base64 data or file path depending on storage_type
  created_at INTEGER
);
```

**Design Decisions:**
- `storage_type` allows flexibility: embed small files as base64, store larger files on disk, or reference existing project files
- `session_id` enables querying all files for a session without joins
- Cascade delete cleans up attachments when messages/sessions are deleted

### Phase 2: Backend API Changes

#### 2.1 Create Shared Multer Configuration

**New File:** `packages/server/src/middleware/upload.js`

```javascript
import multer from 'multer';

// Reusable upload configuration
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10 // Max 10 files per request
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = [
      'image/png', 'image/jpeg', 'image/gif', 'image/webp',
      'text/plain', 'text/markdown', 'text/csv',
      'application/json', 'application/pdf',
      'application/javascript', 'text/javascript',
      // Add more as needed
    ];
    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('text/')) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  }
});
```

#### 2.2 Update Session Creation Endpoint

**File:** `packages/server/src/api/projects.js`

```javascript
import { upload } from '../middleware/upload.js';

// Change from JSON body to multipart form-data
router.post('/:id/sessions', upload.array('files', 10), async (req, res) => {
  // Parse JSON fields from form data
  const { prompt, name, mode, thinkingEnabled, gitBranch, gitMode } = req.body;

  // Handle files
  const files = req.files || [];

  // ... existing session creation logic ...

  // Store attachments if any
  if (files.length > 0) {
    const messageId = /* get the user message id */;
    await attachments.createBatch(sessionId, messageId, files);
  }
});
```

#### 2.3 Update Message Sending Endpoint

**File:** `packages/server/src/api/sessions.js`

```javascript
import { upload } from '../middleware/upload.js';

router.post('/:id/message', upload.array('files', 10), async (req, res) => {
  const { content } = req.body;
  const files = req.files || [];

  // ... existing message logic ...

  // Store attachments
  if (files.length > 0) {
    await attachments.createBatch(sessionId, messageId, files);
  }
});
```

#### 2.4 Create Attachments Data Access Module

**New File:** `packages/server/src/data/attachments.js`

```javascript
import { v4 as uuid } from 'uuid';
import { db } from './db.js';

export const attachments = {
  async create(sessionId, messageId, file) {
    const id = uuid();
    const isLarge = file.size > 1024 * 1024; // 1MB threshold

    let storageType = 'base64';
    let content = file.buffer.toString('base64');

    // For large files, could store to disk instead
    // if (isLarge) { ... }

    await db.run(`
      INSERT INTO message_attachments
      (id, message_id, session_id, filename, mime_type, size_bytes, storage_type, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, messageId, sessionId, file.originalname, file.mimetype, file.size, storageType, content, Date.now()]);

    return { id, filename: file.originalname, mimeType: file.mimetype, size: file.size };
  },

  async createBatch(sessionId, messageId, files) {
    return Promise.all(files.map(f => this.create(sessionId, messageId, f)));
  },

  async getByMessage(messageId) {
    return db.all('SELECT * FROM message_attachments WHERE message_id = ?', [messageId]);
  },

  async getBySession(sessionId) {
    return db.all('SELECT * FROM message_attachments WHERE session_id = ? ORDER BY created_at', [sessionId]);
  }
};
```

#### 2.5 Update Session Manager for Claude SDK

**File:** `packages/server/src/services/sessionManager.js`

When sending to Claude, include file contents in the message:

```javascript
// In runSession() and continueSession()
async function buildMessageWithAttachments(content, attachmentsList) {
  if (!attachmentsList || attachmentsList.length === 0) {
    return content;
  }

  // For text files, include content inline
  // For images, Claude supports base64 image content
  let augmentedContent = content;

  for (const att of attachmentsList) {
    if (att.mime_type.startsWith('text/') || att.mime_type === 'application/json') {
      const textContent = Buffer.from(att.content, 'base64').toString('utf-8');
      augmentedContent += `\n\n--- File: ${att.filename} ---\n${textContent}\n--- End File ---`;
    }
    // Images would need to be passed as image content blocks to Claude
  }

  return augmentedContent;
}
```

### Phase 3: Shared Contracts Update

**File:** `packages/shared/src/contracts/sessions.js`

```javascript
// Add attachment response type
export const AttachmentResponse = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid().nullable(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  createdAt: z.number()
});

// Update message response to include attachments
export const ConversationMessageResponse = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  toolUse: z.array(z.any()).nullable(),
  attachments: z.array(AttachmentResponse).optional(), // NEW
  timestamp: z.number(),
});
```

### Phase 4: Frontend Changes

#### 4.1 Create Reusable FileAttachment Component

**New File:** `packages/web/src/components/FileAttachment.vue`

```vue
<template>
  <div class="file-attachments">
    <!-- File Input -->
    <input
      type="file"
      ref="fileInput"
      multiple
      :accept="acceptTypes"
      @change="handleFileSelect"
      class="hidden"
    />

    <!-- Attach Button -->
    <button @click="$refs.fileInput.click()" class="attach-btn" title="Attach files">
      📎
    </button>

    <!-- Drag & Drop Zone (optional overlay) -->
    <div
      v-if="isDragging"
      class="drop-zone"
      @drop.prevent="handleDrop"
      @dragover.prevent
      @dragleave="isDragging = false"
    >
      Drop files here
    </div>

    <!-- Attached Files List -->
    <div v-if="files.length > 0" class="attached-files">
      <div v-for="(file, index) in files" :key="index" class="file-chip">
        <span class="file-icon">{{ getFileIcon(file) }}</span>
        <span class="file-name">{{ file.name }}</span>
        <span class="file-size">({{ formatSize(file.size) }})</span>
        <button @click="removeFile(index)" class="remove-btn">×</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, defineEmits, defineProps } from 'vue';

const props = defineProps({
  maxFiles: { type: Number, default: 10 },
  maxSize: { type: Number, default: 10 * 1024 * 1024 } // 10MB
});

const emit = defineEmits(['update:files']);

const files = ref([]);
const isDragging = ref(false);
const fileInput = ref(null);

function handleFileSelect(e) {
  addFiles(Array.from(e.target.files));
}

function handleDrop(e) {
  isDragging.value = false;
  addFiles(Array.from(e.dataTransfer.files));
}

function addFiles(newFiles) {
  for (const file of newFiles) {
    if (files.value.length >= props.maxFiles) break;
    if (file.size > props.maxSize) {
      alert(`File ${file.name} exceeds maximum size`);
      continue;
    }
    files.value.push(file);
  }
  emit('update:files', files.value);
}

function removeFile(index) {
  files.value.splice(index, 1);
  emit('update:files', files.value);
}

function clear() {
  files.value = [];
  emit('update:files', []);
}

defineExpose({ clear });
</script>
```

#### 4.2 Update NewSessionView.vue

Add the FileAttachment component to the session creation form:

```vue
<template>
  <!-- ... existing form ... -->

  <div class="prompt-section">
    <label for="prompt">Initial Prompt</label>
    <textarea id="prompt" v-model="prompt" required />

    <!-- NEW: File attachments -->
    <FileAttachment ref="fileAttachment" v-model:files="attachedFiles" />
  </div>

  <!-- ... rest of form ... -->
</template>

<script setup>
import FileAttachment from '../components/FileAttachment.vue';

const attachedFiles = ref([]);
const fileAttachment = ref(null);

async function createSession() {
  // ... validation ...

  await sessionsStore.createSession(projectId, {
    prompt: prompt.value,
    name: name.value,
    mode: mode.value,
    thinkingEnabled: thinkingEnabled.value,
    gitBranch: gitBranch.value,
    files: attachedFiles.value // NEW
  });

  fileAttachment.value?.clear();
}
</script>
```

#### 4.3 Update ConversationTab.vue

Add file attachment to follow-up messages:

```vue
<template>
  <!-- In the message input section -->
  <div class="message-input-area">
    <textarea v-model="messageContent" />

    <!-- NEW: File attachments -->
    <FileAttachment ref="fileAttachment" v-model:files="attachedFiles" />

    <button @click="sendMessage">Send</button>
  </div>
</template>

<script setup>
import FileAttachment from './FileAttachment.vue';

const attachedFiles = ref([]);

async function sendMessage() {
  await sessionsStore.sendMessage(sessionId, messageContent.value, attachedFiles.value);
  messageContent.value = '';
  fileAttachment.value?.clear();
}
</script>
```

#### 4.4 Update API Client

**File:** `packages/web/src/api.js`

```javascript
async createSession(projectId, data) {
  const { files, ...jsonData } = data;

  // Use FormData if files are attached, otherwise JSON
  if (files && files.length > 0) {
    const formData = new FormData();
    formData.append('prompt', jsonData.prompt);
    if (jsonData.name) formData.append('name', jsonData.name);
    if (jsonData.mode) formData.append('mode', jsonData.mode);
    if (jsonData.thinkingEnabled !== undefined) {
      formData.append('thinkingEnabled', jsonData.thinkingEnabled);
    }
    if (jsonData.gitBranch) formData.append('gitBranch', jsonData.gitBranch);

    for (const file of files) {
      formData.append('files', file);
    }

    const response = await fetch(`${this.#baseUrl}/projects/${projectId}/sessions`, {
      method: 'POST',
      body: formData // No Content-Type header - browser sets it with boundary
    });
    return response.json();
  }

  // Existing JSON path
  return this.#post(`/projects/${projectId}/sessions`, jsonData);
}

async sendMessage(sessionId, content, files = []) {
  if (files && files.length > 0) {
    const formData = new FormData();
    formData.append('content', content);
    for (const file of files) {
      formData.append('files', file);
    }

    const response = await fetch(`${this.#baseUrl}/sessions/${sessionId}/message`, {
      method: 'POST',
      body: formData
    });
    return response.json();
  }

  return this.#post(`/sessions/${sessionId}/message`, { content });
}
```

#### 4.5 Update Sessions Store

**File:** `packages/web/src/stores/sessions.js`

```javascript
async createSession(projectId, data) {
  // data now may include files array
  const session = await api.createSession(projectId, data);
  // ... existing logic ...
}

async sendMessage(sessionId, content, files = []) {
  await api.sendMessage(sessionId, content, files);
  // ... existing logic ...
}
```

### Phase 5: Display Attachments in Conversation

#### 5.1 Update Message Display Component

Show attached files in the conversation view:

```vue
<!-- In message rendering -->
<div v-if="message.attachments?.length" class="message-attachments">
  <div v-for="att in message.attachments" :key="att.id" class="attachment">
    <span class="icon">{{ getIcon(att.mimeType) }}</span>
    <span class="name">{{ att.filename }}</span>
    <span class="size">({{ formatSize(att.size) }})</span>
  </div>
</div>
```

#### 5.2 Update Messages API to Include Attachments

**File:** `packages/server/src/api/sessions.js`

```javascript
router.get('/:id/messages', async (req, res) => {
  const messages = await conversationMessages.getBySession(sessionId);

  // Fetch attachments for each message
  const messagesWithAttachments = await Promise.all(
    messages.map(async (msg) => ({
      ...msg,
      attachments: await attachments.getByMessage(msg.id)
    }))
  );

  res.json(messagesWithAttachments);
});
```

---

## File Types Support

| Category | Extensions | Handling |
|----------|------------|----------|
| Images | png, jpg, gif, webp | Pass to Claude as image content blocks |
| Text | txt, md, json, csv | Inline in message content |
| Code | js, py, ts, etc. | Inline in message content with syntax hint |
| Documents | pdf | Extract text or pass as document block |

---

## Testing Checklist

- [ ] Create session with single file attachment
- [ ] Create session with multiple file attachments
- [ ] Send follow-up message with file attachment
- [ ] Verify files display in conversation
- [ ] Test file size limits
- [ ] Test file type restrictions
- [ ] Test drag-and-drop upload
- [ ] Verify attachments survive page refresh
- [ ] Test attachment cleanup on session delete

---

## Future Enhancements

1. **Project file references**: Allow selecting files from the project instead of uploading
2. **Preview**: Click to preview images/text files
3. **Download**: Allow downloading attached files
4. **Large file storage**: Store files on disk instead of in database for files > 1MB
5. **File deduplication**: Hash-based deduplication for identical files

---

## Estimated Effort

| Phase | Files | Complexity | Est. Time |
|-------|-------|------------|-----------|
| Phase 1: Database | 2 | Low | 30 min |
| Phase 2: Backend | 4 | Medium | 2 hours |
| Phase 3: Contracts | 1 | Low | 15 min |
| Phase 4: Frontend | 5 | Medium | 2 hours |
| Phase 5: Display | 2 | Low | 1 hour |
| **Total** | | | **~6 hours** |
