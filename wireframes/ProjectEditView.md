# ProjectEditView Wireframe

The ProjectEditView provides a form for creating a new project or editing an existing one.
A project defines a working directory where all its sessions will run. When editing,
additional sections for project tool templates are displayed.

## Create New Project View

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  New Project                                            |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Create a project to organize Claude Code sessions that share      |
|  the same working directory.                                       |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  PROJECT NAME *                                                    |
|  +--------------------------------------------------------------+ |
|  | [e.g., My Web App                                           ] | |
|  +--------------------------------------------------------------+ |
|  A descriptive name for your project                              |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  WORKING DIRECTORY *                                               |
|  +--------------------------------------------------------------+ |
|  | [/Users/developer/projects/my-app               ] [Browse]   | |
|  +--------------------------------------------------------------+ |
|  All sessions in this project will run in this directory.         |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Recent directories:                                               |
|  [/Users/dev/project-a] [/Users/dev/project-b] [/Users/dev/work]  |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|                                           [Cancel]  [Create Project]|
|                                                                    |
+------------------------------------------------------------------+
```

## Edit Existing Project View

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  Edit Project                                           |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  PROJECT NAME *                                                    |
|  +--------------------------------------------------------------+ |
|  | [My Web App                                                 ] | |
|  +--------------------------------------------------------------+ |
|  A descriptive name for your project                              |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  WORKING DIRECTORY *                                               |
|  +--------------------------------------------------------------+ |
|  | [/Users/developer/projects/my-app               ] [Browse]   | |
|  +--------------------------------------------------------------+ |
|  All sessions in this project will run in this directory.         |
|                                                                    |
|  Note: Changing the working directory will affect all future       |
|  sessions. Existing sessions will continue using their original    |
|  working directory.                                                |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  PROJECT TOOL TEMPLATES                               (id="tools") |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  Tool templates for sessions in this project. Prompt tools    | |
|  |  populate the message input; command tools run shell commands.| |
|  |                                                              | |
|  |  +--------------------------------------------------------+  | |
|  |  | [>] Run Tests          command    npm test             |  | |
|  |  +--------------------------------------------------------+  | |
|  |  | [>] Code Review        prompt     Review this code...  |  | |
|  |  +--------------------------------------------------------+  | |
|  |  | [>] Deploy Staging     command    ./deploy.sh staging  |  | |
|  |  +--------------------------------------------------------+  | |
|  |                                                              | |
|  |                       [+ New Project Tool Template]          | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|                                           [Cancel]  [Save Changes] |
|                                                                    |
+------------------------------------------------------------------+
```

## Form Fields Detail

### Project Name
```
+------------------------------------------------------------------+
| PROJECT NAME *                                          Required   |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| |                                                              | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Placeholder: "e.g., My Web App"                                   |
| Help text: "A descriptive name for your project"                  |
| Validation: Required, max 100 characters                          |
+------------------------------------------------------------------+
```

### Working Directory
```
+------------------------------------------------------------------+
| WORKING DIRECTORY *                                     Required   |
+------------------------------------------------------------------+
| +---------------------------------------------------+ +--------+ |
| | /path/to/directory                                | | Browse | |
| +---------------------------------------------------+ +--------+ |
|                                                                    |
| Help text: "All sessions in this project will run in this directory."|
| Validation: Must be valid absolute path, must exist                |
| Browse button: Opens system file picker (if supported)             |
+------------------------------------------------------------------+

Recent directories (shown below input):
+------------------------------------------------------------------+
| Recent:                                                            |
| [/Users/dev/project-a] [/Users/dev/project-b] [/Users/dev/work]   |
+------------------------------------------------------------------+
```

### Project Tool Templates (Edit view only)
```
+------------------------------------------------------------------+
| PROJECT TOOL TEMPLATES                                             |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| |  Tool templates for sessions in this project. Prompt tools    | |
| |  populate the message input; command tools run shell commands.| |
| +--------------------------------------------------------------+ |
|                                                                    |
| Tool list item:                                                    |
| +--------------------------------------------------------------+ |
| | [>] Tool Name       type (command/prompt)    payload...       | |
| +--------------------------------------------------------------+ |
|                                                                    |
| - Click row to navigate to EditProjectToolTemplateView            |
| - Type badge shows "command" or "prompt"                          |
| - Payload shown truncated with ellipsis                           |
|                                                                    |
| [+ New Project Tool Template] button navigates to                  |
| NewProjectToolTemplateView                                         |
+------------------------------------------------------------------+

Empty state (no tools configured):
+--------------------------------------------------------------+
|                                                              |
|                    [Tools Icon]                              |
|                                                              |
|        No project tool templates configured                   |
|                                                              |
|  Create tool templates to run commands or send prompts        |
|  from sessions in this project.                              |
|                                                              |
|          [+ Create Project Tool Template]                     |
|                                                              |
+--------------------------------------------------------------+
```

## States

### Loading State (fetching project data for edit)
```
+------------------------------------------------------------------+
| [<- Back]  Edit Project                                            |
+------------------------------------------------------------------+
|                                                                    |
|  [Spinner] Loading project...                                      |
|                                                                    |
+------------------------------------------------------------------+
```

### Validation Errors
```
+------------------------------------------------------------------+
| PROJECT NAME *                                          Required   |
| +--------------------------------------------------------------+ |
| |                                                              | |
| +--------------------------------------------------------------+ |
| [!] This field is required                              (red text)|
+------------------------------------------------------------------+

+------------------------------------------------------------------+
| WORKING DIRECTORY *                                     Required   |
| +--------------------------------------------------------------+ |
| | /invalid/path                                                | |
| +--------------------------------------------------------------+ |
| [!] Directory does not exist                            (red text)|
+------------------------------------------------------------------+
```

### Submitting State
```
+------------------------------------------------------------------+
|                                                                    |
|                              [Cancel]  [Creating...] (disabled)    |
|                                        [Spinner]                   |
+------------------------------------------------------------------+
```

## Interactions

1. **Project Name**
   - Required text input
   - Focus on page load for new projects
   - Pre-filled with existing value when editing

2. **Working Directory**
   - Required text input
   - Browse button opens file picker dialog
   - Validates path exists on blur
   - Recent directories shown as quick-select chips
   - Pre-filled with existing value when editing

3. **Project Tool Templates** (Edit view only)
   - Click tool row to navigate to EditProjectToolTemplateView
   - Click "New Project Tool Template" to navigate to NewProjectToolTemplateView
   - Section scrollable if many tools configured

4. **Cancel Button**
   - Returns to ProjectListView (if creating)
   - Returns to SessionListView for this project (if editing)
   - Confirms if form has unsaved changes

5. **Create Project / Save Changes Button**
   - Validates all required fields
   - Shows loading state while creating/saving
   - On success:
     - Creating: Navigates to SessionListView for new project
     - Editing: Navigates back to SessionListView
   - Shows error toast on failure

## Responsive Behavior

### Mobile (<768px)
- Full-width form fields
- Browse button stacks below input on narrow screens
- Recent directories wrap to multiple lines

### Tablet/Desktop (>768px)
- Centered form with max-width container
- Browse button inline with input
- Recent directories in single row (scrollable if needed)
