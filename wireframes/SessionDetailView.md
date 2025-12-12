# SessionDetailView Wireframe

The SessionDetailView shows the full conversation for a single Claude Code session,
with a tabbed sub-navigation for Conversation, Changes (diffs), Toolbox, and Commands.

## Full View with Tab Navigation

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  Fix authentication bug                [Running *]      |
|             /path/to/project  |  Branch: feature/auth-fix          |
|                                                                    |
+------------------------------------------------------------------+
|  TAB NAVIGATION                                                    |
|  +------------+------------+------------+------------+             |
|  | Conversation| Changes(3)| Toolbox(2) | Commands  |             |
|  +------------+------------+------------+------------+-------------+
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
|  +------------+------------+------------+------------+             |
|  |[*]Conversation| Changes(3)| Toolbox(2) | Commands  |           |
|  +------------+------------+------------+------------+-------------+
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
|  | Type / for commands                                          | |
+------------------------------------------------------------------+
```

## Changes Tab (Diff View)

```
+------------------------------------------------------------------+
|  [<- Back]  Fix authentication bug                [Running *]      |
|             /path/to/project  |  Branch: feature/auth-fix          |
+------------------------------------------------------------------+
|  +------------+------------+------------+------------+             |
|  | Conversation|[*]Changes(3)| Toolbox(2) | Commands  |           |
|  +------------+------------+------------+------------+-------------+
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

## Toolbox Tab

```
+------------------------------------------------------------------+
|  [<- Back]  Fix authentication bug                [Running *]      |
|             /path/to/project  |  Branch: feature/auth-fix          |
+------------------------------------------------------------------+
|  +------------+------------+------------+------------+             |
|  | Conversation| Changes(3)|[*]Toolbox(2)| Commands  |            |
|  +------------+------------+------------+------------+-------------+
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
|                    [Toolbox Icon]                            |
|                                                              |
|                 Toolbox is empty                             |
|                                                              |
|      Claude will add screenshots, documents, and data        |
|      here as it works on this session.                       |
|                                                              |
+--------------------------------------------------------------+
```

## Commands Tab

```
+------------------------------------------------------------------+
|  [<- Back]  Fix authentication bug                [Running *]      |
|             /path/to/project  |  Branch: feature/auth-fix          |
+------------------------------------------------------------------+
|  +------------+------------+------------+------------+             |
|  | Conversation| Changes(3)| Toolbox(2) |[*]Commands |            |
|  +------------+------------+------------+------------+-------------+
|                                                                    |
|  Search: [Search commands...______]            [+ New Command]     |
|                                                                    |
|  BUILT-IN COMMANDS                                                 |
|  +--------------------------------------------------------------+ |
|  |  /help                                                       | |
|  |  Show available commands and help information     [builtin]  | |
|  +--------------------------------------------------------------+ |
|  |  /clear                                                      | |
|  |  Clear conversation history                       [builtin]  | |
|  +--------------------------------------------------------------+ |
|  |  /model                                                      | |
|  |  Change the AI model (sonnet, opus, haiku)        [builtin]  | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  PROJECT COMMANDS (.claude/commands/)                              |
|  +--------------------------------------------------------------+ |
|  |  /fix-issue                                                  | |
|  |  Fix a GitHub issue by number                     [project]  | |
|  +--------------------------------------------------------------+ |
|  |  /review-pr                                                  | |
|  |  Review a pull request                            [project]  | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  PERSONAL COMMANDS (~/.claude/commands/)                           |
|  +--------------------------------------------------------------+ |
|  |  /security-review                                 [Edit][X]  | |
|  |  Perform security audit on the codebase           [user]     | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
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
| [                                                        ] [Send] |
| Type a message... (Shift+Enter for newline)                       |
| Type / for commands                                               |
+------------------------------------------------------------------+
```

### Disabled (Session Running)
```
+------------------------------------------------------------------+
| [Session is running... waiting for response            ] [Send]   |
|                                                         (disabled)|
+------------------------------------------------------------------+
```

### Command Palette Active
```
+------------------------------------------------------------------+
| [/                                                       ] [Send] |
+------------------------------------------------------------------+
| COMMANDS                                                          |
| +--------------------------------------------------------------+ |
| | /clear        Clear conversation history              builtin | |
| | /model        Change the model                        builtin | |
| | /fix-issue    Fix a GitHub issue                     project | |
| | /optimize     Optimize code performance              project | |
| +--------------------------------------------------------------+ |
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

## Toolbox Item Components

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

## Command Components

### Command Card
```
+------------------------------------------------------------------+
|  /command-name                                       [Edit] [X]    |
|  Description of what this command does              [project]      |
|  Arguments: arg1 (required), arg2 (optional)                       |
+------------------------------------------------------------------+

Badges:
- [builtin] - Gray badge, system commands (no edit/delete)
- [project] - Blue badge, team-shared commands
- [user]    - Purple badge, personal commands
```

### New/Edit Command Modal
```
+------------------------------------------------------------------+
|  CREATE NEW COMMAND                                    [X] Close   |
+------------------------------------------------------------------+
|  COMMAND NAME *                                                    |
|  [my-command                                                   ]   |
|                                                                    |
|  DESCRIPTION *                                                     |
|  [Brief description...                                         ]   |
|                                                                    |
|  PROMPT CONTENT *                                                  |
|  [Use $ARGUMENTS for user input...                             ]   |
|                                                                    |
|  SAVE LOCATION                                                     |
|  ( ) Project (.claude/commands/)                                   |
|  (*) Personal (~/.claude/commands/)                                |
|                                                                    |
|                                            [Cancel]  [Save Command]|
+------------------------------------------------------------------+
```

## Interactions

1. **Back Button**
   - Returns to SessionListView

2. **Tab Switching**
   - Click tab to switch between Conversation, Changes, Toolbox, Commands
   - Badge on tabs shows counts (file changes, toolbox items)
   - URL updates to reflect current tab (e.g., /sessions/:id/changes)

3. **Message Sending** (Conversation tab)
   - Enter key sends message (when session is waiting)
   - Shift+Enter for newlines
   - Disabled when session is running

4. **Auto-scroll** (Conversation tab)
   - Conversation auto-scrolls to bottom on new messages
   - User can scroll up to view history
   - "New messages" button appears when scrolled up

5. **Diff Navigation** (Changes tab)
   - Click file in tree to scroll to that file's diff
   - Collapse/expand file sections

6. **Toolbox Items** (Toolbox tab)
   - Click item to expand in modal
   - [X] button to delete item
   - Filter/sort controls
   - Grid/list view toggle

7. **Commands** (Commands tab)
   - Search to filter commands
   - Click command to see details
   - Edit/delete custom commands
   - Create new commands

8. **Command Palette** (Conversation tab input)
   - Triggered by `/` at start of message
   - Arrow keys to navigate
   - Enter to select command

## Responsive Behavior

### Mobile (<768px)
- Tabs become scrollable horizontal strip
- Full-width content
- Stacked toolbox items (1 column)
- Message input fixed at bottom

### Tablet (768px - 1024px)
- All tabs visible
- 2-column toolbox grid
- Side-by-side diff available

### Desktop (>1024px)
- Full tab bar
- 3-4 column toolbox grid
- Wider diff view

## Real-time Updates

- New messages appear instantly via WebSocket
- Toolbox items animate in when added
- Changes tab updates when files are modified
- Tab badges update in real-time
- Commands list updates when files change
