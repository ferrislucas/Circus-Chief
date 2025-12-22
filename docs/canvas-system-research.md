# Canvas System Research

> Research document for implementing `CanvasRead` tool to give Claude Code read access to canvas files.

## Current State Overview

The canvas system allows Claude to **add** items to a visual canvas that users can see. Currently, Claude can write but cannot read back canvas contents.

---

## API Endpoints

### Existing Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sessions/:id/canvas` | Add a new canvas item |
| `GET` | `/api/sessions/:id/canvas` | List all canvas items for a session |
| `DELETE` | `/api/sessions/:id/canvas/:itemId` | Delete a specific canvas item |

**Location:** `/packages/server/src/api/canvas.js`

### POST Endpoint Details

The POST endpoint supports multiple input formats:

1. **Multipart file upload** - Direct file upload via `file` field
2. **JSON with `filePath`** - Read file from filesystem path
3. **JSON with `content`** - Inline content or data URL
4. **JSON with `data` + `mimeType`** - Base64 encoded data

---

## Database Schema

Canvas items are stored in SQLite in the `canvas_items` table:

```sql
CREATE TABLE IF NOT EXISTS canvas_items (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image', 'markdown', 'text', 'json')),
  content TEXT,           -- For markdown/text
  data TEXT,              -- For json (stored as JSON string) or image (base64)
  mime_type TEXT,         -- For images
  filename TEXT,
  label TEXT,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
```

**Location:** `/packages/server/src/schema.sql`

---

## Canvas Item Data Model

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Unique identifier (auto-generated) |
| `sessionId` | UUID | Yes | Associated session |
| `type` | enum | Yes | `'image'`, `'markdown'`, `'text'`, `'json'` |
| `content` | string | No | Main content for markdown/text types |
| `data` | string | No | Base64 image data or JSON string |
| `mimeType` | string | No | MIME type for images |
| `filename` | string | No | Original or assigned filename |
| `label` | string | No | User-provided label/title |
| `width` | number | No | Width in pixels (images) |
| `height` | number | No | Height in pixels (images) |
| `createdAt` | number | Yes | Unix timestamp (ms) |

### Zod Schemas

**Location:** `/packages/shared/src/contracts/canvas.js`

```javascript
export const CreateCanvasItemRequest = z.object({
  type: z.enum(['image', 'markdown', 'text', 'json']),
  content: z.string().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
  label: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export const CanvasItemResponse = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  type: z.enum(['image', 'markdown', 'text', 'json']),
  content: z.string().nullable(),
  data: z.string().nullable(),
  mimeType: z.string().nullable(),
  filename: z.string().nullable(),
  label: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  createdAt: z.number(),
});
```

---

## Content Type Handling

### How Different Types Are Stored

| Type | Primary Field | Secondary Field | Notes |
|------|---------------|-----------------|-------|
| `text` | `content` | - | Plain text |
| `markdown` | `content` | - | Markdown source |
| `json` | `data` | - | Stringified JSON |
| `image` | `data` | `mimeType` | Base64 encoded |

### Image Processing

When an image is added via `filePath`:

1. File is read from filesystem
2. Extension determines MIME type:
   - `.png` → `image/png`
   - `.jpg`, `.jpeg` → `image/jpeg`
   - `.gif` → `image/gif`
   - `.webp` → `image/webp`
   - `.svg` → `image/svg+xml`
   - `.bmp` → `image/bmp`
   - `.ico` → `image/x-icon`
3. File contents are base64 encoded
4. Stored in `data` field

When an image is added via data URL (`data:image/...;base64,...`):
1. MIME type is extracted from URL
2. Base64 data is extracted
3. Both stored in respective fields

---

## Real-Time Synchronization

Canvas uses WebSocket for real-time updates across clients.

### Message Types

**Location:** `/packages/shared/src/protocol.js`

```javascript
CANVAS_ADD: 'canvas:add'     // Payload: { item: CanvasItem }
CANVAS_REMOVE: 'canvas:remove' // Payload: { sessionId, itemId }
```

### Broadcast Flow

1. API endpoint creates/deletes canvas item
2. `broadcastToSession()` sends WebSocket message
3. All connected clients receive update
4. Frontend store updates state

---

## Key Files Reference

### Backend

| File | Purpose |
|------|---------|
| `/packages/server/src/api/canvas.js` | Route handlers |
| `/packages/server/src/services/canvasStore.js` | Service layer with broadcast |
| `/packages/server/src/db/CanvasItemRepository.js` | Database access |
| `/packages/server/src/schema.sql` | Table definitions |

### Frontend

| File | Purpose |
|------|---------|
| `/packages/web/src/stores/canvas.js` | Pinia state store |
| `/packages/web/src/api/ApiClient.js` | HTTP client |
| `/packages/web/src/components/CanvasTab.vue` | Main canvas UI |
| `/packages/web/src/components/CanvasFileList.vue` | File listing |
| `/packages/web/src/components/CanvasFileViewer.vue` | File viewer |

### Shared

| File | Purpose |
|------|---------|
| `/packages/shared/src/contracts/canvas.js` | Zod validation schemas |
| `/packages/shared/src/types.js` | TypeScript types |
| `/packages/shared/src/protocol.js` | WebSocket message types |

---

## How Claude Currently Adds to Canvas

Based on the system prompt, Claude is instructed to POST artifacts:

```
POST http://localhost:5000/api/sessions/{session_id}/canvas
Body: {"type": "image|markdown|text|json", "content": "...", "title": "..."}

For images, use filePath to reference an image file on disk:
Body: {"type": "image", "filePath": "/path/to/image.png", "title": "..."}
```

**Note:** The system prompt uses `title` but the actual API uses `label`. This may need alignment.

---

## Observations for CanvasRead Implementation

### Existing GET Endpoint

There's already a `GET /api/sessions/:id/canvas` endpoint that returns all items. This could be leveraged.

### Identification Options

Items can be identified by:
1. `id` - UUID (guaranteed unique)
2. `filename` - User-friendly but may have duplicates (versioning)
3. `label` - User-provided, optional

### Versioning

The frontend groups items by filename, supporting multiple versions. The store's `groupedItems` getter handles this, returning the latest version with a count.

### Content Retrieval Considerations

- **Text/Markdown:** Return `content` field directly
- **JSON:** Parse `data` field and return
- **Images:** Return base64 `data` with `mimeType`, or provide as data URL

### Missing Functionality for CanvasRead

1. **Single item GET by filename** - Currently must fetch all and filter
2. **PDF support** - Not in current type enum (`'image'`, `'markdown'`, `'text'`, `'json'`)
3. **Claude tool integration** - No tool exists; Claude must use curl via Bash

---

## Next Steps

1. Decide on CanvasRead tool interface (parameters, return format)
2. Consider adding `pdf` to supported types
3. Implement GET endpoint for single item by filename
4. Create CanvasRead tool definition
5. Update system prompt to document the new capability
