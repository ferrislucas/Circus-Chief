# SessionDetailView Wireframe

The SessionDetailView shows the full conversation for a single Claude Code session,
with a tabbed sub-navigation for Conversation, Changes (diffs), and Canvas.

## Full View with Tab Navigation

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  Fix authentication bug                [Running *]      |
|             /path/to/project  |  Branch: feature/auth-fix          |
|                                                                    |
+------------------------------------------------------------------+
|  TAB NAVIGATION                                                    |
|  +------------+------------+------------+                          |
|  | Conversation| Changes(3)| Canvas(2) |                          |
|  +------------+------------+------------+--------------------------+
|                                                                    |
|  TAB CONTENT (varies by selected tab)                              |
|                                                                    |
+------------------------------------------------------------------+
```

## Conversation Tab (Default)

```
+------------------------------------------------------------------+
|  [<- Back]  Fix authentication bug                [Running *]      |
|             /path/to/project  |  Branch: feature/auth-fix          |
+------------------------------------------------------------------+
|  +------------+------------+------------+                          |
|  |[*]Conversation| Changes(3)| Canvas(2) |                        |
|  +------------+------------+------------+--------------------------+
|                                                                    |
|  CONVERSATION AREA (scrollable)                                    |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  +----------------------------------------------------------+| |
|  |  | USER MESSAGE                                   10:32 AM  || |
|  |  +----------------------------------------------------------+| |
|  |  |                                                          || |
|  |  |  Fix the OAuth2 refresh token bug in the authentication  || |
|  |  |  service. The tokens aren't being refreshed properly     || |
|  |  |  before they expire.                                     || |
|  |  |                                                          || |
|  |  +----------------------------------------------------------+| |
|  |                                                              | |
|  |  +----------------------------------------------------------+| |
|  |  | ASSISTANT MESSAGE                              10:32 AM  || |
|  |  +----------------------------------------------------------+| |
|  |  |                                                          || |
|  |  |  I'll investigate the OAuth2 refresh token issue. Let me || |
|  |  |  first examine the authentication service.               || |
|  |  |                                                          || |
|  |  |  +------------------------------------------------------+|| |
|  |  |  | Tool: Read                                           ||| |
|  |  |  | src/services/auth.js                                 ||| |
|  |  |  +------------------------------------------------------+|| |
|  |  |                                                          || |
|  |  |  I found the issue. The `refreshToken` function is not   || |
|  |  |  checking if the token is close to expiring...           || |
|  |  |                                                          || |
|  |  |  ```javascript                                           || |
|  |  |  // Fixed implementation                                 || |
|  |  |  async function refreshToken() {                         || |
|  |  |    const expiresIn = getTokenExpiry();                   || |
|  |  |    if (expiresIn < TOKEN_REFRESH_THRESHOLD) {            || |
|  |  |      // ... code                                         || |
|  |  |    }                                                     || |
|  |  |  }                                                       || |
|  |  |  ```                                                     || |
|  |  +----------------------------------------------------------+| |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
|  MESSAGE INPUT                                                     |
|  +--------------------------------------------------------------+ |
|  | Type a message... (Shift+Enter for newline)            [Send]| |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

## Changes Tab (Diff View)

```
+------------------------------------------------------------------+
|  [<- Back]  Fix authentication bug                [Running *]      |
|             /path/to/project  |  Branch: feature/auth-fix          |
+------------------------------------------------------------------+
|  +------------+------------+------------+                          |
|  | Conversation|[*]Changes(3)| Canvas(2) |                        |
|  +------------+------------+------------+--------------------------+
|                                                                    |
|  DIFF CONTROLS                                                     |
|  +--------------------------------------------------------------+ |
|  | View: [Line-by-line v]  |  Baseline: abc1234 (10:32 AM)      | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  CHANGED FILES (collapsible tree)                                  |
|  +--------------------------------------------------------------+ |
|  | [-] src/                                                     | |
|  |     [~] services/auth.js           (modified)                | |
|  |     [+] services/auth.test.js      (added)                   | |
|  | [-] tests/                                                   | |
|  |     [~] integration/auth.test.js   (modified)                | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  DIFF VIEWER (scrollable)                                          |
|  +--------------------------------------------------------------+ |
|  | src/services/auth.js                                         | |
|  +--------------------------------------------------------------+ |
|  |  @@ -45,6 +45,15 @@ function authenticateUser() {           | |
|  |   45    const token = getStoredToken();                      | |
|  |   46    if (!token) return null;                             | |
|  |   47                                                         | |
|  | + 48    // Check if token needs refresh                      | |
|  | + 49    const expiresIn = getTokenExpiry(token);             | |
|  | + 50    if (expiresIn < TOKEN_REFRESH_THRESHOLD) {           | |
|  | + 51      token = await refreshToken(token);                 | |
|  | + 52    }                                                    | |
|  |   53                                                         | |
|  |   54    return validateToken(token);                         | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Canvas Tab

```
+------------------------------------------------------------------+
|  [<- Back]  Fix authentication bug                [Running *]      |
|             /path/to/project  |  Branch: feature/auth-fix          |
+------------------------------------------------------------------+
|  +------------+------------+------------+                          |
|  | Conversation| Changes(3)|[*]Canvas(2)|                         |
|  +------------+------------+------------+--------------------------+
|                                                                    |
|  Filter: [All Types v]  Sort: [Newest v]    View: [Grid] [List]   |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  +-------------------+  +-------------------+                 | |
|  |  | [IMAGE PREVIEW]   |  | [JSON ICON]       |                 | |
|  |  |                   |  |                   |                 | |
|  |  | Screenshot.png    |  | test-results.json |                 | |
|  |  |                   |  |                   |                 | |
|  |  | Test failure #1   |  | Test Results      |                 | |
|  |  | 2m ago       [X]  |  | 5m ago       [X]  |                 | |
|  |  +-------------------+  +-------------------+                 | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+

Empty state:
+--------------------------------------------------------------+
|                                                              |
|                    [Canvas Icon]                            |
|                                                              |
|                 Canvas is empty                             |
|                                                              |
|      Claude will add screenshots, documents, and data        |
|      here as it works on this session.                       |
|                                                              |
+--------------------------------------------------------------+
```

## Message Components

### User Message
```
+------------------------------------------------------------------+
|                                                           10:32 AM |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  User's message content goes here. This can be multi-line   | |
|  |  and will wrap appropriately.                               | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                       [User Avatar]|
+------------------------------------------------------------------+

Style: Right-aligned, accent background color (e.g., blue)
```

### Assistant Message
```
+------------------------------------------------------------------+
| [Claude Avatar]                                                    |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  Assistant's response with **markdown** support.             | |
|  |                                                              | |
|  |  - Bullet points work                                        | |
|  |  - Code blocks render with syntax highlighting               | |
|  |                                                              | |
|  |  ```javascript                                               | |
|  |  const example = "syntax highlighted";                       | |
|  |  ```                                                         | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                           10:32 AM |
+------------------------------------------------------------------+

Style: Left-aligned, neutral background (e.g., gray)
```

### Tool Use Indicator
```
+------------------------------------------------------------------+
| Within assistant message:                                          |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | [Tool Icon]  Read                                            | |
|  | Path: src/services/auth.js                                   | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | [Tool Icon]  Edit                                            | |
|  | File: src/services/auth.js                                   | |
|  | Lines: 45-52                                                 | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | [Tool Icon]  Bash                                            | |
|  | Command: npm test                                            | |
|  | [Expand to see output]                                       | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

## Message Input States

### Default (Session Waiting)
```
+------------------------------------------------------------------+
|  MODE: [Plan v]                                                    |
+------------------------------------------------------------------+
| [                                                        ] [Send] |
| Type a message... (Shift+Enter for newline)                       |
+------------------------------------------------------------------+
```

### Mode Selector (above input)
```
+------------------------------------------------------------------+
|  MODE: [Standard v]                                                |
+------------------------------------------------------------------+

Dropdown options:
+------------------------------------------------------------------+
|  MODE:                                                             |
|  +--------------------------------------------------------------+ |
|  |  ( ) Plan     - Creates a plan before making changes          | |
|  |  (•) Standard - Normal mode with tool confirmations           | |
|  |  ( ) Yolo     - Execute without confirmations                 | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+

Mode descriptions shown on hover/select:
- Plan: Claude will analyze the task and create a detailed plan,
  waiting for your approval before making any file changes.
- Standard: Claude asks for confirmation before running tools that
  modify files or execute commands. Recommended for most use.
- Yolo: Claude executes all tools without confirmation. Use with
  caution - best for trusted, well-defined tasks.
```

### Disabled (Session Running)
```
+------------------------------------------------------------------+
|  MODE: [Standard] (disabled while running)                         |
+------------------------------------------------------------------+
| [Session is running... waiting for response            ] [Send]   |
|                                                         (disabled)|
+------------------------------------------------------------------+
```

## Status Indicators

### Session Header Status
```
Running:    [Spinner] Running...
Waiting:    [?] Waiting for input
Completed:  [v] Completed
Error:      [!] Error: Connection lost
Starting:   [Spinner] Starting session...
```

### Typing Indicator
```
+------------------------------------------------------------------+
| [Claude Avatar]                                                    |
|  +--------------------------------------------------------------+ |
|  |  [... animated dots ...]                                     | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

## Canvas Item Components

### Image Item Card
```
+---------------------------+
|   [IMAGE THUMBNAIL]       |
|   (max-height: 150px)     |
+---------------------------+
| filename.png              |
| Label: Test Screenshot    |
| 2 minutes ago        [X]  |
+---------------------------+
```

### JSON/Markdown/Text Item Card
```
+---------------------------+
|   +-------------------+   |
|   | Preview content   |   |
|   | truncated...      |   |
|   +-------------------+   |
+---------------------------+
| filename.json             |
| Label: Test Results       |
| 5 minutes ago        [X]  |
+---------------------------+
```

### Expanded Item Modal
```
+------------------------------------------------------------------+
|  filename.png                                       [X] Close      |
+------------------------------------------------------------------+
|                                                                    |
|                     [FULL SIZE CONTENT]                            |
|                     (image, markdown rendered, JSON formatted)     |
|                                                                    |
+------------------------------------------------------------------+
| Type: image/png  |  Size: 1920x1080  |  Added: 10:32 AM           |
+------------------------------------------------------------------+
|                      [Download]  [Copy]                            |
+------------------------------------------------------------------+
```

## Diff Viewer Details

### File Status Icons
```
[+] Added      (green)
[~] Modified   (yellow/orange)
[-] Deleted    (red)
[R] Renamed    (blue)
```

### View Toggle
```
+------------------------+
| View: [Line-by-line v] |
+------------------------+
  - Line-by-line (unified diff)
  - Side-by-side (split view)
```

### Diff Colors
```
Added lines:    Green background (#e6ffec or similar)
Deleted lines:  Red background (#ffebe9 or similar)
Unchanged:      No background
Line numbers:   Gray, non-selectable
```

## Interactions

1. **Back Button**
   - Returns to SessionListView for the project

2. **Tab Switching**
   - Click tab to switch between Conversation, Changes, Canvas
   - Badge on tabs shows counts (file changes, canvas items)
   - URL updates to reflect current tab (e.g., /sessions/:id/changes)

3. **Mode Selector** (Conversation tab)
   - Dropdown above message input to select execution mode
   - Options: Plan, Standard, Yolo
   - Can be changed before each message
   - Disabled while session is running
   - Mode change takes effect on next message sent
   - Current mode indicated by selected option

4. **Message Sending** (Conversation tab)
   - Enter key sends message (when session is waiting)
   - Shift+Enter for newlines
   - Disabled when session is running
   - Message sent with currently selected mode

5. **Auto-scroll** (Conversation tab)
   - Conversation auto-scrolls to bottom on new messages
   - User can scroll up to view history
   - "New messages" button appears when scrolled up

6. **Diff Navigation** (Changes tab)
   - Click file in tree to scroll to that file's diff
   - Collapse/expand file sections

7. **Canvas Items** (Canvas tab)
   - Click item to expand in modal
   - [X] button to delete item
   - Filter/sort controls
   - Grid/list view toggle

## Responsive Behavior

### Mobile (<768px)
- Tabs become scrollable horizontal strip
- Full-width content
- Stacked canvas items (1 column)
- Message input fixed at bottom

### Tablet (768px - 1024px)
- All tabs visible
- 2-column canvas grid
- Side-by-side diff available

### Desktop (>1024px)
- Full tab bar
- 3-4 column canvas grid
- Wider diff view

## Real-time Updates

- New messages appear instantly via WebSocket
- Canvas items animate in when added
- Changes tab updates when files are modified
- Tab badges update in real-time
