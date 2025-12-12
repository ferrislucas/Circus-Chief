# AppLayout Wireframe

The application uses a mobile-friendly layout with top navigation.
This layout is defined in `App.vue` and wraps all views.

## Full Layout

```
+------------------------------------------------------------------+
|  HEADER / TOP NAV                                                 |
|  +--------------------------------------------------------------+ |
|  |  [logo] claudetools.io    [Sessions]  [+ New]    [Connected] | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
|                                                                    |
|  MAIN CONTENT AREA                                                 |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  <router-view>                                               | |
|  |                                                              | |
|  |  Content rendered based on current route:                    | |
|  |                                                              | |
|  |  - SessionListView (/ - default)                             | |
|  |  - SessionDetailView (/sessions/:id)                         | |
|  |  - NewSessionView (/sessions/new)                            | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Header / Top Navigation

```
+------------------------------------------------------------------+
|                                                                    |
|  [Claude Icon]  claudetools.io                                    |
|                                                                    |
|                           [Sessions]  [+ New Session]  [*] Connected|
|                                                                    |
+------------------------------------------------------------------+

Legend:
- [Claude Icon]: Application logo/branding
- "claudetools.io": Application name
- [Sessions]: Navigate to session list (active when on /, /sessions/:id)
- [+ New Session]: Primary action, routes to /sessions/new
- [*] Connected: WebSocket connection status indicator
  - Green dot = Connected
  - Red dot = Disconnected (with reconnect attempt info)
```

## Mobile Layout (<768px)

```
+--------------------------------+
|  [=]  claudetools.io    [*]    |
+--------------------------------+
|                                |
|  MAIN CONTENT AREA             |
|                                |
|  +----------------------------+|
|  |                            ||
|  |  <router-view>             ||
|  |                            ||
|  |  Full width content        ||
|  |                            ||
|  +----------------------------+|
|                                |
+--------------------------------+

[=] Hamburger menu reveals:
+--------------------------------+
|  Sessions                      |
|  + New Session                 |
+--------------------------------+
```

## Tablet Layout (768px - 1024px)

```
+------------------------------------------------------------------+
|  [logo] claudetools.io          [Sessions] [+ New]    [Connected] |
+------------------------------------------------------------------+
|                                                                    |
|  MAIN CONTENT AREA (full width)                                    |
|                                                                    |
+------------------------------------------------------------------+
```

## Desktop Layout (>1024px)

```
+------------------------------------------------------------------+
|  [logo] claudetools.io          [Sessions] [+ New]    [Connected] |
+------------------------------------------------------------------+
|                                                                    |
|  MAIN CONTENT AREA (max-width container, centered)                 |
|                                                                    |
+------------------------------------------------------------------+
```

## Component States

### Connection Status
```
Connected:    [Green Dot] Connected
Disconnected: [Red Dot] Disconnected - Retrying...
Reconnecting: [Yellow Dot] Reconnecting (3)...
```

## Interactions

1. **Logo Click**
   - Returns to session list (home)

2. **Sessions Nav**
   - Routes to SessionListView (/)
   - Active state when on any session route

3. **New Session Button**
   - Primary action button (accent color)
   - Routes to NewSessionView (/sessions/new)

4. **Connection Status**
   - Click to see connection details (optional)
   - Shows reconnect attempt count when disconnected

5. **Mobile Hamburger Menu**
   - Slides in from left or drops down
   - Contains navigation items
   - Closes on route change or outside click
