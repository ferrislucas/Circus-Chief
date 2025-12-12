# HomeView Wireframe

The HomeView is the main layout container that provides the overall structure for the application.
It contains a sidebar, header, and main content area.

```
+------------------------------------------------------------------+
|  HEADER                                                           |
|  +--------------------------------------------------------------+ |
|  |  [logo] claudetools.io           [Connected] [Settings]      | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
|        |                                                          |
|  S     |  MAIN CONTENT AREA                                       |
|  I     |                                                          |
|  D     |  +------------------------------------------------------+|
|  E     |  |                                                      ||
|  B     |  |  <router-view>                                       ||
|  A     |  |                                                      ||
|  R     |  |  Content rendered based on current route:            ||
|        |  |                                                      ||
|  +---+ |  |  - SessionListView (default)                         ||
|  |   | |  |  - SessionDetailView (/sessions/:id)                 ||
|  | N | |  |  - NewSessionView (/sessions/new)                    ||
|  | A | |  |  - ToolboxView (/toolbox)                            ||
|  | V | |  |  - CommandsView (/commands)                          ||
|  |   | |  |                                                      ||
|  +---+ |  |                                                      ||
|        |  |                                                      ||
|        |  |                                                      ||
|        |  +------------------------------------------------------+|
|        |                                                          |
+------------------------------------------------------------------+
```

## Header Section

```
+------------------------------------------------------------------+
|                                                                    |
|  [Claude Icon]  claudetools.io                                    |
|                                                                    |
|                                        [*] Connected    [Gear]    |
|                                                                    |
+------------------------------------------------------------------+

Legend:
- [Claude Icon]: Application logo/branding
- "claudetools.io": Application name
- [*] Connected: WebSocket connection status indicator
  - Green dot = Connected
  - Red dot = Disconnected (with reconnect attempt info)
- [Gear]: Settings button (future feature)
```

## Sidebar Section

```
+------------------+
|                  |
|  NAVIGATION      |
|                  |
|  +------------+  |
|  | Sessions   |  |  <-- Active state when on session routes
|  +------------+  |
|  +------------+  |
|  | Toolbox    |  |  <-- Active state when on /toolbox
|  +------------+  |
|  +------------+  |
|  | Commands   |  |  <-- Active state when on /commands
|  +------------+  |
|                  |
|  +-----------+   |
|  | + New     |   |  <-- Creates new session
|  | Session   |   |
|  +-----------+   |
|                  |
|  SESSION LIST    |
|  (when expanded) |
|                  |
|  +------------+  |
|  | Session 1  |  |
|  | [Running]  |  |
|  +------------+  |
|  +------------+  |
|  | Session 2  |  |
|  | [Waiting]  |  |
|  +------------+  |
|  +------------+  |
|  | Session 3  |  |
|  | [Complete] |  |
|  +------------+  |
|                  |
+------------------+
```

## Responsive Behavior

### Desktop (>1024px)
- Sidebar always visible (fixed width ~280px)
- Main content fills remaining space

### Tablet (768px - 1024px)
- Sidebar collapsible with hamburger menu
- Main content takes full width when sidebar hidden

### Mobile (<768px)
- Sidebar becomes bottom navigation or slide-out drawer
- Full-screen content area

## Component States

### Connection Status
```
Connected:    [Green Dot] Connected
Disconnected: [Red Dot] Disconnected - Retrying...
Reconnecting: [Yellow Dot] Reconnecting (3)...
```

## Interactions

1. **Sidebar Navigation**
   - Click nav item to route to that section
   - Active item highlighted with accent color/background

2. **Session Quick Access**
   - Session list in sidebar for quick switching
   - Clicking session navigates to SessionDetailView

3. **New Session Button**
   - Primary action button, always visible in sidebar
   - Routes to NewSessionView

4. **Connection Status**
   - Click to see connection details (optional)
   - Shows reconnect attempt count when disconnected
