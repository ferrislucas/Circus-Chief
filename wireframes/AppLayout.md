# AppLayout Wireframe

The application uses a mobile-friendly layout with top navigation.
This layout is defined in `App.vue` and wraps all views.

## Full Layout

```
+------------------------------------------------------------------+
|  HEADER / TOP NAV                                                 |
|  +--------------------------------------------------------------+ |
|  |  [logo] claudetools.io  [Projects] [Tools] [+ New] [*] [Cog] | |
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
|  |  - ProjectListView (/ - default)                             | |
|  |  - ProjectEditView (/projects/new, /projects/:id/edit)       | |
|  |  - SessionListView (/projects/:projectId/sessions)           | |
|  |  - SessionDetailView (/sessions/:id)                         | |
|  |  - NewSessionView (/projects/:projectId/sessions/new)        | |
|  |  - ToolsGlobalView (/tools)                                  | |
|  |  - NewGlobalToolTemplateView (/tools/new)                    | |
|  |  - EditGlobalToolTemplateView (/tools/:id/edit)              | |
|  |  - SettingsView (/settings)                                  | |
|  |  - NewProjectToolTemplateView (/projects/:id/tools/new)      | |
|  |  - EditProjectToolTemplateView (/projects/:id/tools/:toolId) | |
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
|            [Projects] [Tools] [+ New Project]  [*] Connected [Cog]|
|                                                                    |
+------------------------------------------------------------------+

Legend:
- [Claude Icon]: Application logo/branding
- "claudetools.io": Application name
- [Projects]: Navigate to project list (active when on /)
- [Tools]: Navigate to global tools list (/tools)
- [+ New Project]: Primary action, routes to /projects/new
- [*] Connected: WebSocket connection status indicator
  - Green dot = Connected
  - Red dot = Disconnected (with reconnect attempt info)
- [Cog]: Settings icon, routes to /settings
```

## Mobile Layout (<768px)

```
+--------------------------------+
|  [=]  claudetools.io  [*] [Cog]|
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
|  Projects                      |
|  Tools                         |
|  + New Project                 |
+--------------------------------+
```

## Tablet Layout (768px - 1024px)

```
+------------------------------------------------------------------+
|  [logo] claudetools.io    [Projects] [Tools] [+ New] [*] [Cog]    |
+------------------------------------------------------------------+
|                                                                    |
|  MAIN CONTENT AREA (full width)                                    |
|                                                                    |
+------------------------------------------------------------------+
```

## Desktop Layout (>1024px)

```
+------------------------------------------------------------------+
|  [logo] claudetools.io    [Projects] [Tools] [+ New] [*] [Cog]    |
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
   - Returns to project list (home)

2. **Projects Nav**
   - Routes to ProjectListView (/)
   - Active state when on any project route

3. **Tools Nav**
   - Routes to ToolsGlobalView (/tools)
   - Active state when on /tools or /tools/*

4. **New Project Button**
   - Primary action button (accent color)
   - Routes to ProjectEditView (/projects/new)

5. **Connection Status**
   - Click to see connection details (optional)
   - Shows reconnect attempt count when disconnected

6. **Settings Cog**
   - Routes to SettingsView (/settings)
   - Active state when on /settings

7. **Mobile Hamburger Menu**
   - Slides in from left or drops down
   - Contains navigation items (Projects, Tools, + New Project)
   - Closes on route change or outside click
