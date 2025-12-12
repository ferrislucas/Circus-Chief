# SessionDetailView Wireframe

The SessionDetailView shows the full conversation for a single Claude Code session,
along with a tabbed interface to view file changes (diffs).

## Full View with Conversation Tab

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  Fix authentication bug                [Running *]      |
|             /path/to/project  |  Branch: feature/auth-fix          |
|                                                                    |
+------------------------------------------------------------------+
|  TABS                                                              |
|  +------------------+------------------+                           |
|  | [*] Conversation | [ ] Changes (3)  |                          |
|  +------------------+------------------+---------------------------+
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
|  |  +----------------------------------------------------------+| |
|  |  | USER MESSAGE                                   10:35 AM  || |
|  |  +----------------------------------------------------------+| |
|  |  |  Great! Can you also add unit tests for this?            || |
|  |  +----------------------------------------------------------+| |
|  |                                                              | |
|  |  +----------------------------------------------------------+| |
|  |  | ASSISTANT MESSAGE                              10:35 AM  || |
|  |  +----------------------------------------------------------+| |
|  |  |  [Typing indicator...]                                   || |
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

## Changes Tab View (Diff)

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  Fix authentication bug                [Running *]      |
|             /path/to/project  |  Branch: feature/auth-fix          |
|                                                                    |
+------------------------------------------------------------------+
|  TABS                                                              |
|  +------------------+------------------+                           |
|  | [ ] Conversation | [*] Changes (3)  |                          |
|  +------------------+------------------+---------------------------+
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
|  | src/services/auth.test.js (new file)                         | |
|  +--------------------------------------------------------------+ |
|  | + 1   import { refreshToken } from './auth';                 | |
|  | + 2                                                          | |
|  | + 3   describe('refreshToken', () => {                       | |
|  | + 4     it('should refresh expired tokens', async () => {    | |
|  | + 5       // ...                                             | |
|  | + 6     });                                                  | |
|  | + 7   });                                                    | |
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
   - Returns to SessionListView

2. **Tab Switching**
   - Click tab to switch between Conversation and Changes
   - Badge on Changes tab shows file count

3. **Message Sending**
   - Enter key sends message (when session is waiting)
   - Shift+Enter for newlines
   - Disabled when session is running

4. **Auto-scroll**
   - Conversation auto-scrolls to bottom on new messages
   - User can scroll up to view history
   - "New messages" button appears when scrolled up

5. **Diff Navigation**
   - Click file in tree to scroll to that file's diff
   - Collapse/expand file sections
   - Copy diff to clipboard (optional)

6. **Tool Use Expansion**
   - Click tool indicator to expand/collapse details
   - Show full bash output when expanded
