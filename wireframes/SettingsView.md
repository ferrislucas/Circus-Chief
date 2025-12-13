# SettingsView Wireframe

The SettingsView provides access to application-wide settings, including management
of global tool templates and links to project tool templates.

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  Settings                                               |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  GLOBAL TOOL TEMPLATES                                             |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  Tool templates that run shell commands across all sessions  | |
|  |                                                              | |
|  |  +--------------------------------------------------------+  | |
|  |  | [>] Run Tests              npm test                    |  | |
|  |  +--------------------------------------------------------+  | |
|  |  | [>] Deploy Staging         ./deploy.sh staging         |  | |
|  |  +--------------------------------------------------------+  | |
|  |  | [>] Generate Docs          npm run docs                |  | |
|  |  +--------------------------------------------------------+  | |
|  |                                                              | |
|  |                          [+ New Global Tool Template]        | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  PROJECT TOOL TEMPLATES                                            |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  Tool templates are configured per-project. Select a project | |
|  |  to manage its tool templates.                               | |
|  |                                                              | |
|  |  +--------------------------------------------------------+  | |
|  |  | [>] My Web App           3 tools configured            |  | |
|  |  +--------------------------------------------------------+  | |
|  |  | [>] API Server           1 tool configured             |  | |
|  |  +--------------------------------------------------------+  | |
|  |  | [>] Mobile App           0 tools configured            |  | |
|  |  +--------------------------------------------------------+  | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Global Tool Template List Item

```
+--------------------------------------------------------------+
| [>] Tool Name                    Payload preview...           |
+--------------------------------------------------------------+

- Click anywhere on row to navigate to EditGlobalToolTemplateView
- [>] indicates clickable/navigable item
- Payload shown truncated with ellipsis if too long
```

## Project Tool Template List Item

```
+--------------------------------------------------------------+
| [>] Project Name                 N tools configured           |
+--------------------------------------------------------------+

- Click anywhere on row to navigate to ProjectEditView with tools section focused
- Shows count of tools configured for that project
```

## Empty States

### No Global Tool Templates
```
+--------------------------------------------------------------+
|                                                              |
|                    [Tools Icon]                              |
|                                                              |
|           No global tool templates configured                 |
|                                                              |
|    Global tools run shell commands across all sessions.       |
|    Create one to automate common tasks like running tests     |
|    or deployments.                                           |
|                                                              |
|              [+ Create Global Tool Template]                  |
|                                                              |
+--------------------------------------------------------------+
```

### No Projects
```
+--------------------------------------------------------------+
|                                                              |
|                    [Folder Icon]                             |
|                                                              |
|                    No projects yet                            |
|                                                              |
|    Create a project to configure project-specific tools.      |
|                                                              |
|                    [+ New Project]                            |
|                                                              |
+--------------------------------------------------------------+
```

## Loading State

```
+------------------------------------------------------------------+
|  [<- Back]  Settings                                               |
+------------------------------------------------------------------+
|                                                                    |
|  GLOBAL TOOL TEMPLATES                                             |
|  +--------------------------------------------------------------+ |
|  |  [Spinner] Loading tool templates...                         | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  PROJECT TOOL TEMPLATES                                            |
|  +--------------------------------------------------------------+ |
|  |  [Spinner] Loading projects...                               | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Interactions

1. **Back Button**
   - Returns to previous view (typically ProjectListView)

2. **Global Tool Template Row Click**
   - Navigates to EditGlobalToolTemplateView (/tools/:id/edit)

3. **New Global Tool Template Button**
   - Navigates to NewGlobalToolTemplateView (/tools/new)

4. **Project Row Click**
   - Navigates to ProjectEditView with tools section (/projects/:id/edit#tools)

## Responsive Behavior

### Mobile (<768px)
- Full-width sections
- Stacked list items
- Payload preview may be hidden on narrow screens

### Tablet/Desktop (>768px)
- Centered content with max-width container
- Full payload preview visible
- Hover states on list items
