# SessionListView Wireframe

The SessionListView displays all Claude Code sessions within a specific project.
This view is accessed by clicking on a project from the ProjectListView.

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Projects]  My Web App                          [+ New Session]|
|                 /Users/dev/projects/my-web-app                     |
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
|  |  |          Branch: feature/auth-fix          [Running *]   || |
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
|  |  |          Branch: main                      [Waiting ?]   || |
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
|  |  |          Branch: refactor/db               [Completed v] || |
|  |  |                                                          || |
|  |  |  "All database operations have been migrated to..."      || |
|  |  |                                                 1h ago   || |
|  |  +----------------------------------------------------------+| |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Header with Project Context

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Projects]  Project Name                        [+ New Session]|
|                 /absolute/path/to/working/directory                |
|                                                                    |
+------------------------------------------------------------------+

Legend:
- [<- Projects]: Back navigation to ProjectListView
- Project Name: Name of the current project
- Working Directory: Shown below project name in smaller text
- [+ New Session]: Creates new session in this project
```

## Session Card Component (within project context)

```
+------------------------------------------------------------------+
|                                                                    |
|  [Session Icon]   Session Name                      [Status Badge] |
|                                                                    |
|  Branch: branch-name (if in git repo)                              |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  "Preview of the last message in the conversation, trunca..." | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  12 messages                                             3m ago    |
|                                                                    |
+------------------------------------------------------------------+

Note: Working directory is NOT shown on individual session cards
since all sessions share the project's working directory.
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
|  [<- Projects]  My Web App                          [+ New Session]|
|                 /Users/dev/projects/my-web-app                     |
|                                                                    |
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
|  [<- Projects]  My Web App                                         |
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
+------------------------------------------------------------------+
```

## Filter & Sort Options

### Search
- Searches session name and message content
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

1. **Back to Projects**
   - [<- Projects] link returns to ProjectListView

2. **Session Card Click**
   - Navigate to SessionDetailView for that session
   - Highlight card on hover with subtle background change

3. **New Session Button**
   - Primary action button (accent color)
   - Routes to NewSessionView with project context

4. **Status Badge**
   - Clicking "Waiting" status shows quick input option (optional enhancement)
   - Clicking "Error" shows error details tooltip

5. **Session Actions (on hover)**
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
