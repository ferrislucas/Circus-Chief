# ProjectListView Wireframe

The ProjectListView displays all projects in a list format.
This is the default view when navigating to the root path or "Projects" navigation.

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  PROJECTS                                            [+ New Project]|
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Filter: [Search projects...____________]  Sort: [Newest First v] |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  Project Card 1                                              | |
|  |  +----------------------------------------------------------+| |
|  |  |  [Icon]  My Web App                                      || |
|  |  |          /Users/dev/projects/my-web-app                  || |
|  |  |                                                          || |
|  |  |  3 sessions  |  2 active                     Updated 2m  || |
|  |  +----------------------------------------------------------+| |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  Project Card 2                                              | |
|  |  +----------------------------------------------------------+| |
|  |  |  [Icon]  API Backend                                     || |
|  |  |          /Users/dev/projects/api-backend                 || |
|  |  |                                                          || |
|  |  |  5 sessions  |  0 active                     Updated 1h  || |
|  |  +----------------------------------------------------------+| |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  Project Card 3                                              | |
|  |  +----------------------------------------------------------+| |
|  |  |  [Icon]  Mobile App                                      || |
|  |  |          /Users/dev/projects/mobile-app                  || |
|  |  |                                                          || |
|  |  |  1 session   |  1 active                     Updated 5m  || |
|  |  +----------------------------------------------------------+| |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Project Card Component

```
+------------------------------------------------------------------+
|                                                                    |
|  [Folder Icon]   Project Name                           [Edit] [X] |
|                                                                    |
|  Working Directory: /absolute/path/to/directory                    |
|                                                                    |
|  3 sessions  |  2 active                          Updated 3m ago   |
|                                                                    |
+------------------------------------------------------------------+
```

### Card Information
- **Folder Icon**: Visual indicator for project
- **Project Name**: User-defined project name
- **Working Directory**: The absolute path where sessions run
- **Session Count**: Total number of sessions in the project
- **Active Count**: Number of running/waiting sessions
- **Updated**: Time since last activity in any session

## Empty State

```
+------------------------------------------------------------------+
|                                                                    |
|                     [Illustration]                                 |
|                                                                    |
|                  No projects yet                                   |
|                                                                    |
|         Create a project to organize your Claude Code              |
|         sessions by working directory.                             |
|                                                                    |
|                    [+ Create Project]                              |
|                                                                    |
+------------------------------------------------------------------+
```

## Loading State

```
+------------------------------------------------------------------+
|                                                                    |
|  PROJECTS                                                          |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  [Skeleton loader - animated gradient]                       | |
|  |  ████████████████████                                        | |
|  |  ████████████████████████████                                | |
|  |  ████████████                                 ████           | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  [Skeleton loader - animated gradient]                       | |
|  |  ████████████████████                                        | |
|  |  ████████████████████████████                                | |
|  |  ████████████                                 ████           | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Filter & Sort Options

### Search
- Searches project name and working directory
- Real-time filtering as user types
- Clear button when text present

### Sort Options
```
Dropdown options:
- Newest First (default)
- Oldest First
- Alphabetical (A-Z)
- Alphabetical (Z-A)
- Most Sessions
- Most Active
```

## Interactions

1. **Project Card Click**
   - Navigate to SessionListView for that project
   - Highlight card on hover with subtle background change

2. **New Project Button**
   - Primary action button (accent color)
   - Routes to ProjectEditView (/projects/new)

3. **Edit Button (on hover)**
   - Opens ProjectEditView for editing (/projects/:id/edit)

4. **Delete Button (on hover)**
   - Shows confirmation dialog
   - Warns about deleting all associated sessions
   - On confirm, deletes project and all sessions

5. **Project Actions (on hover)**
   ```
   +------------------------------------------------------------------+
   |  Project Card                                         [Edit] [X]  |
   |  ...                                                              |
   +------------------------------------------------------------------+

   [X] reveals confirmation:
   "Delete this project and all 3 sessions?"
   [Cancel] [Delete]
   ```

## Real-time Updates

- New projects appear at top of list (if sorted by newest)
- Session counts update in real-time via WebSocket
- Active session counts update when sessions start/stop
- "Updated" timestamp refreshes when session activity occurs
