# Fix: "Send to Canvas" for Command Button Output

## Problem

When clicking "Send to Canvas" button on command output, the error occurs:
```
Failed to send to canvas: filePath is required
```

## Root Cause Analysis

There's a mismatch between the frontend request and the backend API:

### Frontend (`CommandsTab.vue` lines 177-189)
Sends in-memory text content:
```javascript
await api.createCanvasItem(props.sessionId, {
  type: 'text',
  filename: `${sanitizedLabel}-output.txt`,
  content: stripAnsi(output),
  label: `${buttonLabel} output`,
});
```

### Backend (`canvas.js` lines 133-137)
Only accepts file paths:
```javascript
const { filePath, label } = req.body;
if (!filePath) {
  return res.status(400).json({ error: 'filePath is required' });
}
```

The canvas API was designed for Claude Code to send files from the filesystem. Command button output exists only in memory, so there's no `filePath` to provide.

## Solution

Extend the canvas POST API to accept **either**:
1. `filePath` - read from disk (existing behavior for Claude Code)
2. `content` + `type` + `filename` - create canvas item from inline content (new behavior for command output)

## Implementation Plan

### 1. Extend Canvas API (`packages/server/src/api/canvas.js`)

Modify the `POST /:id/canvas` handler:

```javascript
router.post('/:id/canvas', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { filePath, label, type, content, filename } = req.body;

  // Option 1: File path provided - read from disk
  if (filePath) {
    // ... existing file-based logic ...
  }
  // Option 2: Inline content provided - create directly
  else if (content !== undefined && type && filename) {
    // Validate type is text-based (not image/pdf which require binary)
    const validInlineTypes = ['text', 'markdown', 'code', 'json'];
    if (!validInlineTypes.includes(type)) {
      return res.status(400).json({
        error: `Invalid type for inline content: ${type}. Valid types: ${validInlineTypes.join(', ')}`
      });
    }

    // Create canvas item from inline content
    const itemData = {
      type,
      content: type === 'json' ? null : content,
      data: type === 'json' ? content : null,
      mimeType: getMimeTypeForType(type),
      filename,
      label: label || null,
    };

    const item = canvasItems.create(req.params.id, itemData);
    broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_ADD, { item });
    return res.status(201).json(item);
  }
  // Neither option provided
  else {
    return res.status(400).json({
      error: 'Either filePath or (content + type + filename) is required'
    });
  }
});
```

### 2. Add Helper Function

Add a helper to map type to MIME type:
```javascript
function getMimeTypeForType(type) {
  switch (type) {
    case 'text': return 'text/plain';
    case 'markdown': return 'text/markdown';
    case 'code': return 'text/plain';
    case 'json': return 'application/json';
    default: return 'text/plain';
  }
}
```

### 3. Add Tests (`packages/server/src/api/canvas.test.js`)

Add test cases for inline content:
- Valid inline text content creates canvas item
- Valid inline markdown content creates canvas item
- Valid inline JSON content creates canvas item
- Invalid inline type (image/pdf) returns error
- Missing required fields returns error

### 4. Update API Documentation

Document the two modes:
- File mode: `{ filePath, label? }`
- Inline mode: `{ type, content, filename, label? }`

## Files to Modify

1. `packages/server/src/api/canvas.js` - Extend POST handler
2. `packages/server/src/api/canvas.test.js` - Add tests (if exists, otherwise create)

## Testing Checklist

- [ ] Existing file-based canvas items still work (Claude Code)
- [ ] Inline text content creates canvas item successfully
- [ ] "Send to Canvas" button on command output works
- [ ] Error handling for invalid requests
- [ ] WebSocket broadcast works for inline content
