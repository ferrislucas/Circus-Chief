# ToolboxView Wireframe

The ToolboxView displays all items that Claude Code has shared to the visual "toolbox".
This includes screenshots, markdown documents, JSON data, and plain text.

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  TOOLBOX                                              [Clear All]  |
|                                                                    |
|  Claude Code can share images, documents, and data here for        |
|  you to view in real-time.                                         |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Filter: [All Types v]  Sort: [Newest First v]  View: [Grid] [List]|
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  ITEMS GRID                                                        |
|                                                                    |
|  +-------------------+  +-------------------+  +-------------------+|
|  | [IMAGE PREVIEW]   |  | [MARKDOWN ICON]   |  | [JSON ICON]      ||
|  |                   |  |                   |  |                   ||
|  | Screenshot.png    |  | Project Plan.md   |  | test-results.json||
|  |                   |  |                   |  |                   ||
|  | Test failure #1   |  | Implementation    |  | Test Results     ||
|  | 2m ago       [X]  |  | 5m ago       [X]  |  | 10m ago     [X]  ||
|  +-------------------+  +-------------------+  +-------------------+|
|                                                                    |
|  +-------------------+  +-------------------+  +-------------------+|
|  | [IMAGE PREVIEW]   |  | [TEXT ICON]       |  | [IMAGE PREVIEW]  ||
|  |                   |  |                   |  |                   ||
|  | Dashboard.png     |  | debug-output.txt  |  | Error-screen.png ||
|  |                   |  |                   |  |                   ||
|  | UI Preview        |  | Debug Log         |  | Error Screenshot ||
|  | 15m ago      [X]  |  | 20m ago      [X]  |  | 1h ago      [X]  ||
|  +-------------------+  +-------------------+  +-------------------+|
|                                                                    |
+------------------------------------------------------------------+
```

## List View

```
+------------------------------------------------------------------+
|                                                                    |
|  TOOLBOX                                              [Clear All]  |
|                                                                    |
+------------------------------------------------------------------+
|  Filter: [All Types v]  Sort: [Newest First v]  View: [Grid] [List]|
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | [Thumb]  Screenshot.png                                      | |
|  |          Test failure #1                        image/png    | |
|  |          Session: Fix auth bug                  2m ago  [X]  | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | [Thumb]  Project Plan.md                                     | |
|  |          Implementation Plan                    text/markdown| |
|  |          Session: New feature                   5m ago  [X]  | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | [Thumb]  test-results.json                                   | |
|  |          Test Results                           application/ | |
|  |          Session: Fix auth bug                  10m ago [X]  | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Item Card Components

### Image Item Card
```
+---------------------------+
|                           |
|   [IMAGE THUMBNAIL]       |
|   (max-height: 150px)     |
|   (object-fit: cover)     |
|                           |
+---------------------------+
| filename.png              |
+---------------------------+
| Label: Test Screenshot    |
| 2 minutes ago        [X]  |
+---------------------------+

Hover state:
+---------------------------+
|   [IMAGE THUMBNAIL]       |
|      [Magnify Icon]       |  <- Click to expand
|                           |
+---------------------------+
```

### Markdown Item Card
```
+---------------------------+
|   +-------------------+   |
|   | # Heading         |   |
|   | Preview of the    |   |
|   | markdown content..|   |
|   |                   |   |
|   +-------------------+   |
+---------------------------+
| document.md               |
+---------------------------+
| Label: Project Plan       |
| 5 minutes ago        [X]  |
+---------------------------+
```

### JSON Item Card
```
+---------------------------+
|   +-------------------+   |
|   | {                 |   |
|   |   "tests": 10,    |   |
|   |   "passed": 8,    |   |
|   |   "failed": 2     |   |
|   | }                 |   |
|   +-------------------+   |
+---------------------------+
| results.json              |
+---------------------------+
| Label: Test Results       |
| 10 minutes ago       [X]  |
+---------------------------+
```

### Text Item Card
```
+---------------------------+
|   +-------------------+   |
|   | Plain text        |   |
|   | content preview   |   |
|   | truncated to fit  |   |
|   | the card...       |   |
|   +-------------------+   |
+---------------------------+
| debug.txt                 |
+---------------------------+
| Label: Debug Output       |
| 15 minutes ago       [X]  |
+---------------------------+
```

## Expanded Item Modal

### Image Expanded
```
+------------------------------------------------------------------+
|                                                     [X] Close      |
+------------------------------------------------------------------+
|                                                                    |
|                     [FULL SIZE IMAGE]                              |
|                                                                    |
|                     (scrollable if larger                          |
|                      than viewport)                                |
|                                                                    |
+------------------------------------------------------------------+
| Filename: screenshot.png                                           |
| Type: image/png                                                    |
| Size: 1920x1080                                                    |
| Label: Test failure screenshot                                     |
| Session: Fix auth bug                                              |
| Added: Dec 12, 2025 at 10:32 AM                                    |
+------------------------------------------------------------------+
|                      [Download]  [Copy to Clipboard]               |
+------------------------------------------------------------------+
```

### Markdown Expanded
```
+------------------------------------------------------------------+
|  Project Plan.md                                    [X] Close      |
+------------------------------------------------------------------+
|  +--------------------------------------------------------------+ |
|  |  # Implementation Plan                                       | |
|  |                                                              | |
|  |  ## Phase 1: Setup                                           | |
|  |                                                              | |
|  |  - Initialize project structure                              | |
|  |  - Configure build tools                                     | |
|  |  - Set up CI/CD pipeline                                     | |
|  |                                                              | |
|  |  ## Phase 2: Core Features                                   | |
|  |                                                              | |
|  |  1. User authentication                                      | |
|  |  2. Dashboard implementation                                 | |
|  |  3. API integration                                          | |
|  |                                                              | |
|  |  ```javascript                                               | |
|  |  const config = {                                            | |
|  |    baseUrl: 'https://api.example.com'                        | |
|  |  };                                                          | |
|  |  ```                                                         | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
|                      [Download]  [Copy Raw]                        |
+------------------------------------------------------------------+
```

### JSON Expanded
```
+------------------------------------------------------------------+
|  test-results.json                                  [X] Close      |
+------------------------------------------------------------------+
|  +--------------------------------------------------------------+ |
|  |  {                                                           | |
|  |    "summary": {                                              | |
|  |      "total": 10,                                            | |
|  |      "passed": 8,                                            | |
|  |      "failed": 2,                                            | |
|  |      "skipped": 0                                            | |
|  |    },                                                        | |
|  |    "tests": [                                                | |
|  |      {                                                       | |
|  |        "name": "User login",                                 | |
|  |        "status": "passed",                                   | |
|  |        "duration": 1234                                      | |
|  |      },                                                      | |
|  |      ...                                                     | |
|  |    ]                                                         | |
|  |  }                                                           | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
|  View: [Formatted v]  |  [Tree View] [Raw]                         |
+------------------------------------------------------------------+
|                      [Download]  [Copy]                            |
+------------------------------------------------------------------+
```

## Empty State

```
+------------------------------------------------------------------+
|                                                                    |
|                      [Toolbox Icon]                                |
|                                                                    |
|                   Toolbox is empty                                 |
|                                                                    |
|        Claude Code will add items here as it works.                |
|        Screenshots, documents, and data will appear                |
|        in real-time.                                               |
|                                                                    |
|        How it works:                                               |
|        Claude can use curl to POST items to the toolbox API,       |
|        or place files in the designated toolbox directory.         |
|                                                                    |
+------------------------------------------------------------------+
```

## Filter & Sort Controls

### Type Filter Dropdown
```
+----------------------+
| All Types            |  <- Default
| Images               |
| Markdown             |
| JSON                 |
| Text                 |
+----------------------+
```

### Sort Dropdown
```
+----------------------+
| Newest First         |  <- Default
| Oldest First         |
| Name (A-Z)           |
| Name (Z-A)           |
| Type                 |
+----------------------+
```

### View Toggle
```
+--------+--------+
| [Grid] | [List] |   <- Toggle between views
+--------+--------+
```

## Interactions

1. **Item Click**
   - Opens expanded modal for that item
   - Escape key or click outside closes modal

2. **Delete Button [X]**
   - Removes item from toolbox
   - Optional: Confirmation dialog for images
   - Broadcasts removal via WebSocket

3. **Clear All Button**
   - Confirmation dialog: "Remove all X items from toolbox?"
   - Clears all items
   - Broadcasts clear via WebSocket

4. **Filter/Sort**
   - Immediately filters/sorts displayed items
   - Persists preference in localStorage

5. **View Toggle**
   - Switches between grid and list views
   - Persists preference in localStorage

6. **Real-time Updates**
   - New items animate in (fade/slide)
   - Removed items animate out
   - Updates show notification badge in nav

## Responsive Behavior

### Desktop (>1024px)
- 3-4 columns in grid view
- Large thumbnails

### Tablet (768px - 1024px)
- 2-3 columns in grid view
- Medium thumbnails

### Mobile (<768px)
- 1-2 columns in grid view
- Or default to list view
- Full-width expanded modals
