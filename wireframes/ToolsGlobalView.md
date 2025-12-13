# ToolsGlobalView Wireframe

The ToolsGlobalView displays all global tool templates and allows users to execute
them or navigate to create/edit views. Global tools execute shell commands that
run in background processes.

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  Global Tools                     [+ New Tool Template] |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Execute shell commands across all sessions. Each tool runs in     |
|  a background process and won't block the UI.                      |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  TOOL TEMPLATES                                                    |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  +--------------------------------------------------------+  | |
|  |  | [Run Tests]    [________________________] [Edit]       |  | |
|  |  | npm test                                                |  | |
|  |  +--------------------------------------------------------+  | |
|  |                                                              | |
|  |  +--------------------------------------------------------+  | |
|  |  | [Deploy]       [________________________] [Edit]       |  | |
|  |  | ./deploy.sh staging                                     |  | |
|  |  +--------------------------------------------------------+  | |
|  |                                                              | |
|  |  +--------------------------------------------------------+  | |
|  |  | [Generate Docs][________________________] [Edit]       |  | |
|  |  | npm run docs                                            |  | |
|  |  +--------------------------------------------------------+  | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Tool Template Item Detail

```
+--------------------------------------------------------------+
| [Button: Name]    [Input field for args]         [Edit]       |
| payload command shown below                                   |
+--------------------------------------------------------------+

Components:
- [Button]: Primary action button with tool name
  - Clicking executes the command with input value appended
  - Disabled while command is running
- [Input field]: Optional arguments to append to command
- [Edit]: Secondary button, navigates to EditGlobalToolTemplateView
- Payload: Command text shown in muted color below
```

## Button States

```
Default state:
+--------------------------------------------------------------+
| [Run Tests]      [test/*.spec.js      ]          [Edit]       |
| npm test                                                      |
+--------------------------------------------------------------+

Running state:
+--------------------------------------------------------------+
| [Running...] (disabled, spinner)  [        ]     [Edit]       |
| npm test test/*.spec.js                                       |
+--------------------------------------------------------------+

After completion (success):
+--------------------------------------------------------------+
| [Run Tests]      [                    ]          [Edit]       |
| npm test                                          [v] Done    |
+--------------------------------------------------------------+

After completion (error):
+--------------------------------------------------------------+
| [Run Tests]      [                    ]          [Edit]       |
| npm test                                          [!] Failed  |
+--------------------------------------------------------------+
```

## Empty State

```
+------------------------------------------------------------------+
|  [<- Back]  Global Tools                     [+ New Tool Template] |
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |                    [Tools Icon]                              | |
|  |                                                              | |
|  |           No global tool templates configured                 | |
|  |                                                              | |
|  |    Create tool templates to run shell commands like           | |
|  |    tests, builds, or deployments from any session.            | |
|  |                                                              | |
|  |              [+ Create Tool Template]                         | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Loading State

```
+------------------------------------------------------------------+
|  [<- Back]  Global Tools                     [+ New Tool Template] |
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  [Spinner] Loading tool templates...                         | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Interactions

1. **Back Button**
   - Returns to previous view (typically ProjectListView or SettingsView)

2. **New Tool Template Button**
   - Navigates to NewGlobalToolTemplateView (/tools/new)

3. **Tool Button Click**
   - Executes the command with input value appended
   - Command runs in background process (non-blocking)
   - Button shows "Running..." state with spinner
   - Button is disabled while running
   - Shows success/error indicator when complete

4. **Input Field**
   - Optional arguments to append to the command
   - Pressing Enter while focused triggers the tool button
   - Cleared after successful execution (optional behavior)

5. **Edit Button**
   - Navigates to EditGlobalToolTemplateView (/tools/:id/edit)

## Command Execution Flow

1. User enters optional arguments in input field
2. User clicks tool button
3. Button enters "Running..." state (disabled)
4. API call: `POST /api/tools/:id/execute` with `{ arguments: "input value" }`
5. Server spawns background process: `<payload> <arguments>`
6. Button re-enables when process completes
7. Success/error indicator shown briefly

## Responsive Behavior

### Mobile (<768px)
- Full-width tool items
- Input field and edit button may stack below button
- Payload text wraps

### Tablet/Desktop (>768px)
- Centered content with max-width container
- Horizontal layout: button, input, edit in one row
- Hover states on buttons
