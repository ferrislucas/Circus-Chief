# SessionDetailView Wireframe

The SessionDetailView shows the full conversation for a single Claude Code session,
with a tabbed sub-navigation for Conversation, Changes (diffs), Canvas, Tools, and Notes.

## Full View with Tab Navigation

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  Fix authentication bug           [Running *]  [...]    |
|             /path/to/project  |  Branch: feature/auth-fix          |
|             PR: #123 (linked)                                       |
|                                                                    |
+------------------------------------------------------------------+
|  TAB NAVIGATION                                                    |
|  +------------+------------+------------+--------+--------+        |
|  | Conversation| Changes(3)| Canvas(2) | Tools | Notes(1)|        |
|  +------------+------------+------------+--------+--------+--------+
|                                                                    |
|  TAB CONTENT (varies by selected tab)                              |
|                                                                    |
+------------------------------------------------------------------+

Legend:
- [...] Session actions menu (rename, link PR, stop, delete)
- PR: #123 (linked) - Shows linked pull request if set
```

## Session Header Actions Menu

```
Clicking [...] reveals dropdown:
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  Fix authentication bug           [Running *]  [...]    |
|                                                    |               |
|                                                    v               |
|                                            +---------------+       |
|                                            | Rename        |       |
|                                            | Link PR       |       |
|                                            | -----------   |       |
|                                            | Stop Session  |       |
|                                            | Delete Session|       |
|                                            +---------------+       |
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

### Canvas Controls Specification

#### Filter Dropdown
```
+--------------------------------------------------------------+
| Filter: [All Types v]                                         |
+--------------------------------------------------------------+
| Dropdown options:                                             |
| +----------------------------------------------------------+ |
| | All Types     - Shows all canvas items (default)          | |
| | Images        - type === 'image' (png, jpg, gif, etc.)    | |
| | Documents     - type === 'markdown'                       | |
| | Text          - type === 'text'                           | |
| | Data          - type === 'json'                           | |
| +----------------------------------------------------------+ |
+--------------------------------------------------------------+
```

#### Sort Dropdown
```
+--------------------------------------------------------------+
| Sort: [Newest v]                                              |
+--------------------------------------------------------------+
| Dropdown options:                                             |
| +----------------------------------------------------------+ |
| | Newest        - createdAt DESC (default)                  | |
| | Oldest        - createdAt ASC                             | |
| | Name A-Z      - label/filename ASC                        | |
| | Name Z-A      - label/filename DESC                       | |
| +----------------------------------------------------------+ |
+--------------------------------------------------------------+
```

#### View Toggle
```
+--------------------------------------------------------------+
| View: [Grid] [List]                                           |
+--------------------------------------------------------------+
| Toggle button group (one active at a time)                    |
|                                                               |
| Grid View (default):                                          |
| - Mobile (<768px): 2 columns                                  |
| - Tablet (768-1024px): 3 columns                              |
| - Desktop (>1024px): 4 columns                                |
| - Shows thumbnail/preview, filename, label, timestamp         |
|                                                               |
| List View:                                                    |
| - Single column, full width                                   |
| - Each row shows: thumbnail (small), filename, type badge,    |
|   label, timestamp, delete button                             |
| - More compact, better for many items                         |
+--------------------------------------------------------------+
```

#### List View Layout
```
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| | [Thumb] screenshot.png    [image]  Test failure   2m ago [X] | |
| +--------------------------------------------------------------+ |
| | [Thumb] results.json      [json]   Test Results   5m ago [X] | |
| +--------------------------------------------------------------+ |
| | [Thumb] notes.md          [markdown] Session notes 1h ago [X]| |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

## Tools Tab

The Tools tab displays project tool templates that can be executed within the session context.

```
+------------------------------------------------------------------+
|  [<- Back]  Fix authentication bug                [Running *]      |
|             /path/to/project  |  Branch: feature/auth-fix          |
+------------------------------------------------------------------+
|  +------------+------------+------------+------------+             |
|  | Conversation| Changes(3)| Canvas(2) |[*]Tools   |             |
|  +------------+------------+------------+------------+-------------+
|                                                                    |
|  PROJECT TOOLS                                                     |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  +--------------------------------------------------------+  | |
|  |  | [Run Tests]  [________________________] (input field)  |  | |
|  |  +--------------------------------------------------------+  | |
|  |                                                              | |
|  |  +--------------------------------------------------------+  | |
|  |  | [Deploy]     [________________________] (input field)  |  | |
|  |  +--------------------------------------------------------+  | |
|  |                                                              | |
|  |  +--------------------------------------------------------+  | |
|  |  | [Lint]       [________________________] (input field)  |  | |
|  |  +--------------------------------------------------------+  | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+

Tool Item Detail:
+--------------------------------------------------------------+
| [Button: Tool Name]  [Input field for arguments]              |
+--------------------------------------------------------------+

Button states:
- Default: Clickable, accent color
- Running: Disabled, shows spinner, muted color
- After click (command type): Button disabled until command completes

Behavior:
- Command type tools: Clicking runs the command with input appended
  in a background process. Button is disabled during execution.
- Prompt type tools: Clicking puts the payload + input into the
  Message input on Conversation tab and switches to that tab with
  focus on the message input control.

Empty state:
+--------------------------------------------------------------+
|                                                              |
|                    [Tools Icon]                              |
|                                                              |
|              No project tools configured                      |
|                                                              |
|      Configure tools in the project settings to run           |
|      commands or send prompts from this session.              |
|                                                              |
|              [Configure Project Tools]                        |
|                                                              |
+--------------------------------------------------------------+
```

## Notes Tab

The Notes tab allows users to add free-form notes about a session. Notes are useful
for capturing context, decisions, or reminders that aren't part of the conversation.

```
+------------------------------------------------------------------+
|  [<- Back]  Fix authentication bug           [Running *]  [...]    |
|             /path/to/project  |  Branch: feature/auth-fix          |
+------------------------------------------------------------------+
|  +------------+------------+------------+--------+--------+        |
|  | Conversation| Changes(3)| Canvas(2) | Tools |[*]Notes(1)|       |
|  +------------+------------+------------+--------+--------+--------+
|                                                                    |
|  SESSION NOTES                                     [+ Add Note]    |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  +----------------------------------------------------------+| |
|  |  | Note 1                                       [Edit] [X]  || |
|  |  +----------------------------------------------------------+| |
|  |  |                                                          || |
|  |  |  ## Decision Made                                        || |
|  |  |  After discussing with the team, we decided to use       || |
|  |  |  the refresh token approach instead of silent auth.      || |
|  |  |                                                          || |
|  |  |  **Reason**: Better security and simpler implementation  || |
|  |  |                                                          || |
|  |  |                                      Added 2 hours ago   || |
|  |  +----------------------------------------------------------+| |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

### Add/Edit Note Modal

```
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |                    Add Note / Edit Note                       | |
|  |                                                              | |
|  |  +----------------------------------------------------------+| |
|  |  |                                                          || |
|  |  |  ## My Note Title                                        || |
|  |  |                                                          || |
|  |  |  Some **markdown** content here...                       || |
|  |  |                                                          || |
|  |  |                                                          || |
|  |  |                                                          || |
|  |  +----------------------------------------------------------+| |
|  |  (Supports markdown formatting)                              | |
|  |                                                              | |
|  |                              [Cancel]  [Save Note]           | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

### Empty State (No Notes)

```
+--------------------------------------------------------------+
|                                                              |
|                    [Notes Icon]                              |
|                                                              |
|                   No notes yet                                |
|                                                              |
|      Add notes to capture decisions, context, or              |
|      reminders about this session.                            |
|                                                              |
|                    [+ Add Note]                               |
|                                                              |
+--------------------------------------------------------------+
```

## Link PR Modal

When user clicks "Link PR" from the session actions menu:

```
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |                    Link Pull Request                          | |
|  |                                                              | |
|  |  PR URL:                                                     | |
|  |  +----------------------------------------------------------+| |
|  |  | https://github.com/org/repo/pull/123                     || |
|  |  +----------------------------------------------------------+| |
|  |  Enter the URL of the pull request created from this session | |
|  |                                                              | |
|  |                              [Cancel]  [Link PR]             | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+

When PR is linked, it appears in the session header:
+------------------------------------------------------------------+
|  [<- Back]  Fix authentication bug           [Running *]  [...]    |
|             /path/to/project  |  Branch: feature/auth-fix          |
|             PR: #123 [view] [unlink]                                |
+------------------------------------------------------------------+

- [view] opens PR in new tab
- [unlink] removes the PR link
```

## Rename Session Modal

When user clicks "Rename" from the session actions menu:

```
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |                    Rename Session                             | |
|  |                                                              | |
|  |  Session Name:                                               | |
|  |  +----------------------------------------------------------+| |
|  |  | Fix authentication bug                                   || |
|  |  +----------------------------------------------------------+| |
|  |                                                              | |
|  |                              [Cancel]  [Save]                | |
|  |                                                              | |
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
   - Click tab to switch between Conversation, Changes, Canvas, Tools
   - Badge on tabs shows counts (file changes, canvas items)
   - URL updates to reflect current tab (e.g., /sessions/:id/changes, /sessions/:id/tools)

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

8. **Tools** (Tools tab)
   - Each tool displays as a button with an adjacent input field
   - Command type tools:
     - Click button to run command with input value appended
     - Command runs in background process (non-blocking)
     - Button disabled while command is running
   - Prompt type tools:
     - Click button to populate Message input with payload + input value
     - Switches to Conversation tab with focus on message input
   - "Configure Project Tools" button navigates to project settings

9. **Notes** (Notes tab)
   - Click "Add Note" to create a new note
   - Click existing note to edit inline
   - Notes support markdown formatting
   - Delete note via [X] button with confirmation

10. **Session Actions Menu** ([...] button)
    - Rename: Opens inline edit field for session name
    - Link PR: Opens modal to enter PR URL
    - Stop Session: Stops running session (shows confirmation)
    - Delete Session: Deletes session (shows confirmation with warning)

## Delete Session Confirmation Dialog

When user clicks "Delete Session" from the actions menu:

### Standard Confirmation (session completed or idle)

```
+--------------------------------------------------------------+
|                     Delete Session?                           |
|                                                              |
|  Are you sure you want to delete "Fix authentication bug"?   |
|                                                              |
|  This will permanently delete:                               |
|  - 24 conversation messages                                  |
|  - 3 canvas items (screenshots, documents)                   |
|  - 1 session note                                            |
|                                                              |
|  This action cannot be undone.                               |
|                                                              |
|                        [Cancel]  [Delete Session]            |
+--------------------------------------------------------------+
```

### Active Session Warning (session running or waiting for input)

```
+--------------------------------------------------------------+
|                   Delete Active Session?                      |
|                                                              |
|  Are you sure you want to delete "Fix authentication bug"?   |
|                                                              |
|  This session is currently running.                          |
|  Deleting it will stop Claude and discard all work in        |
|  progress.                                                   |
|                                                              |
|  This will permanently delete:                               |
|  - 24 conversation messages                                  |
|  - 3 canvas items (screenshots, documents)                   |
|  - 1 session note                                            |
|                                                              |
|  This action cannot be undone.                               |
|                                                              |
|                        [Cancel]  [Delete Session]            |
+--------------------------------------------------------------+
```

### Dialog Behavior
- Counts are dynamically populated based on actual session data
- If a count is zero, that line is omitted (e.g., no "0 canvas items" line)
- Active session warning appears when session status is "running" or "waiting"
- "Delete Session" button uses destructive styling (red background)
- Cancel dismisses dialog without action
- Dialog is modal (blocks interaction with page behind)

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

## Slash Commands UX

Users can invoke slash commands directly from the message input area. Typing `/` at the start
of a message triggers the command autocomplete interface.

### Command Autocomplete

```
+------------------------------------------------------------------+
|  MESSAGE INPUT                                                     |
|  +--------------------------------------------------------------+ |
|  | /mo                                                     [Send]| |
|  +--------------------------------------------------------------+ |
|  +--------------------------------------------------------------+ |
|  | COMMANDS                                                      | |
|  | +----------------------------------------------------------+ | |
|  | | /model [model]     Change Claude model                    | | |
|  | | /mode [mode]       Change execution mode                  | | |
|  | +----------------------------------------------------------+ | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+

Behavior:
- Autocomplete appears when typing "/" at start of message
- List filters as user types (fuzzy matching)
- Arrow keys navigate, Enter selects, Escape closes
- Selected command replaces input text
- Tab completes to first match
```

### Available Built-in Commands

```
+------------------------------------------------------------------+
|  COMMANDS                                                          |
|  +--------------------------------------------------------------+ |
|  | BUILT-IN                                                      | |
|  | /clear         Clear conversation history                     | |
|  | /model [name]  Change Claude model (e.g., /model sonnet)     | |
|  | /mode [mode]   Change mode (plan/standard/yolo)               | |
|  | /status        Show session status                            | |
|  | /cost          Show token usage and estimated cost            | |
|  | /compact       Compact conversation history                   | |
|  |                                                                | |
|  | PROJECT COMMANDS (if configured)                              | |
|  | /review        Run code review                                | |
|  | /test          Run test suite                                 | |
|  | /deploy        Deploy to staging                              | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### Command Palette (Alternative)

Users can also open a command palette using `Cmd/Ctrl + K`:

```
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  Command Palette                                         [X]  | |
|  +--------------------------------------------------------------+ |
|  |  +----------------------------------------------------------+| |
|  |  | Search commands...                                       || |
|  |  +----------------------------------------------------------+| |
|  |                                                              | |
|  |  RECENTLY USED                                               | |
|  |  +----------------------------------------------------------+| |
|  |  | /model sonnet     Change to Claude Sonnet                || |
|  |  | /mode plan        Switch to plan mode                    || |
|  |  +----------------------------------------------------------+| |
|  |                                                              | |
|  |  ALL COMMANDS                                                | |
|  |  +----------------------------------------------------------+| |
|  |  | /clear            Clear history           [Ctrl+Shift+K] || |
|  |  | /model [name]     Change model                           || |
|  |  | /mode [mode]      Change mode                            || |
|  |  | /status           Show status                  [Ctrl+I]  || |
|  |  | /cost             Token usage                            || |
|  |  | /compact          Compact history                        || |
|  |  +----------------------------------------------------------+| |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+

Behavior:
- Opens with Cmd/Ctrl + K keyboard shortcut
- Search filters all available commands
- Shows keyboard shortcuts for commands that have them
- Escape or click outside to close
- Enter executes selected command
```

### Command Execution Feedback

```
After running a command, feedback appears in the conversation:

+------------------------------------------------------------------+
|  +--------------------------------------------------------------+ |
|  | SYSTEM                                              10:35 AM  | |
|  +--------------------------------------------------------------+ |
|  | Model changed to claude-sonnet-4-5                           | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
|  +--------------------------------------------------------------+ |
|  | SYSTEM                                              10:36 AM  | |
|  +--------------------------------------------------------------+ |
|  | Token Usage                                                   | |
|  | Input: 12,450 tokens                                          | |
|  | Output: 3,200 tokens                                          | |
|  | Estimated cost: $0.42                                         | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+

Style: System messages use muted gray background, italic text
```
