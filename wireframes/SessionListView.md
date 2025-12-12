# SessionListView Wireframe

The SessionListView displays all Claude Code sessions in a list format.
This is the default view when navigating to the root path or "Sessions" navigation.

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  SESSIONS                                            [+ New Session]|
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Filter: [Search sessions...____________]  Sort: [Newest First v] |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  Session Card 1                                              | |
|  |  +----------------------------------------------------------+| |
|  |  |  [Icon]  Fix authentication bug                          || |
|  |  |          /path/to/project                   [Running *]  || |
|  |  |          Branch: feature/auth-fix                        || |
|  |  |                                                          || |
|  |  |  "Implementing the OAuth2 refresh token flow..."         || |
|  |  |                                                 2m ago   || |
|  |  +----------------------------------------------------------+| |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  Session Card 2                                              | |
|  |  +----------------------------------------------------------+| |
|  |  |  [Icon]  Add unit tests                                  || |
|  |  |          /path/to/other-project             [Waiting ?]  || |
|  |  |          Branch: main                                    || |
|  |  |                                                          || |
|  |  |  "Ready for your input. What should I test next?"        || |
|  |  |                                                 5m ago   || |
|  |  +----------------------------------------------------------+| |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  Session Card 3                                              | |
|  |  +----------------------------------------------------------+| |
|  |  |  [Icon]  Refactor database layer                         || |
|  |  |          /path/to/db-project               [Completed v] || |
|  |  |          Branch: refactor/db                             || |
|  |  |                                                          || |
|  |  |  "All database operations have been migrated to..."      || |
|  |  |                                                 1h ago   || |
|  |  +----------------------------------------------------------+| |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Session Card Component

```
+------------------------------------------------------------------+
|                                                                    |
|  [Session Icon]   Session Name                      [Status Badge] |
|                                                                    |
|  Working Directory: /absolute/path/to/directory                    |
|  Branch: branch-name (if in git repo)                              |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  "Preview of the last message in the conversation, trunca..." | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  12 messages                                             3m ago    |
|                                                                    |
+------------------------------------------------------------------+
```

### Status Badges

```
Starting:   [Spinner] Starting     (gray, animated)
Running:    [*] Running            (blue, pulsing dot)
Waiting:    [?] Waiting for input  (orange/amber)
Completed:  [v] Completed          (green, checkmark)
Error:      [!] Error              (red, exclamation)
```

## Empty State

```
+------------------------------------------------------------------+
|                                                                    |
|                     [Illustration]                                 |
|                                                                    |
|                  No sessions yet                                   |
|                                                                    |
|         Start a new Claude Code session to get started.            |
|         Claude will help you with coding tasks, debugging,         |
|         and more.                                                  |
|                                                                    |
|                    [+ Create Session]                              |
|                                                                    |
+------------------------------------------------------------------+
```

## Loading State

```
+------------------------------------------------------------------+
|                                                                    |
|  SESSIONS                                                          |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  [Skeleton loader - animated gradient]                       | |
|  |  ████████████████████                         ████████       | |
|  |  ████████████████████████████                                | |
|  |  ████████████                                 ████           | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  [Skeleton loader - animated gradient]                       | |
|  |  ████████████████████                         ████████       | |
|  |  ████████████████████████████                                | |
|  |  ████████████                                 ████           | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  [Skeleton loader - animated gradient]                       | |
|  |  ████████████████████                         ████████       | |
|  |  ████████████████████████████                                | |
|  |  ████████████                                 ████           | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Filter & Sort Options

### Search
- Searches session name, working directory, and message content
- Real-time filtering as user types
- Clear button when text present

### Sort Options
```
Dropdown options:
- Newest First (default)
- Oldest First
- Alphabetical (A-Z)
- Alphabetical (Z-A)
- Status
```

## Interactions

1. **Session Card Click**
   - Navigate to SessionDetailView for that session
   - Highlight card on hover with subtle background change

2. **New Session Button**
   - Primary action button (accent color)
   - Routes to NewSessionView

3. **Status Badge**
   - Clicking "Waiting" status shows quick input option (optional enhancement)
   - Clicking "Error" shows error details tooltip

4. **Session Actions (on hover)**
   ```
   +------------------------------------------------------------------+
   |  Session Card                                         [X] [...]  |
   |  ...                                                             |
   +------------------------------------------------------------------+

   [...] reveals dropdown:
   - Stop Session (if running)
   - Delete Session
   - View in Terminal (future)
   ```

## Real-time Updates

- New sessions appear at top of list (if sorted by newest)
- Status badges update in real-time via WebSocket
- Last message preview updates when new messages arrive
- Message count increments in real-time
