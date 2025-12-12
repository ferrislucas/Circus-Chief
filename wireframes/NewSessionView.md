# NewSessionView Wireframe

The NewSessionView provides a form for creating a new Claude Code session within a project.
The working directory is inherited from the project, so users only need to provide
a name, initial prompt, and optional git configuration.

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  New Session                                            |
|             in My Web App                                          |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Working directory: /Users/developer/projects/my-web-app           |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  SESSION NAME (optional)                                           |
|  +--------------------------------------------------------------+ |
|  | [e.g., Fix login bug                                       ] | |
|  +--------------------------------------------------------------+ |
|  Auto-generated if left blank                                      |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  INITIAL PROMPT *                                                  |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  Describe what you want Claude to help you with...           | |
|  |                                                              | |
|  |                                                              | |
|  |                                                              | |
|  |                                                              | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|  Supports markdown. Be specific about the task and desired outcome.|
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  GIT CONFIGURATION (optional)                                      |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  Worktree:                                                   | |
|  |  +----------------------------------------------------------+| |
|  |  | [Select worktree...                               v]     || |
|  |  +----------------------------------------------------------+| |
|  |  |  /Users/developer/projects/my-web-app (main)             || |
|  |  |  /Users/developer/projects/my-web-app-feature            || |
|  |  |  /Users/developer/projects/my-web-app-hotfix             || |
|  |  +----------------------------------------------------------+| |
|  |                                                              | |
|  |  Branch:                                                     | |
|  |  +----------------------------------------------------------+| |
|  |  | [Select branch...                                 v]     || |
|  |  +----------------------------------------------------------+| |
|  |  |  * main (current)                                        || |
|  |  |    feature/new-login                                     || |
|  |  |    feature/dashboard                                     || |
|  |  |  -- Remote --                                            || |
|  |  |    origin/feature/api-update                             || |
|  |  +----------------------------------------------------------+| |
|  |                                                              | |
|  |  [ ] Create new branch:                                      | |
|  |  +----------------------------------------------------------+| |
|  |  | [Branch name...                                        ] || |
|  |  +----------------------------------------------------------+| |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|                                           [Cancel]  [Create Session]|
|                                                                    |
+------------------------------------------------------------------+
```

## Header with Project Context

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  New Session                                            |
|             in {Project Name}                                      |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Working directory: /absolute/path/from/project                    |
|                                                                    |
+------------------------------------------------------------------+

Legend:
- [<- Back]: Returns to SessionListView for this project
- "in {Project Name}": Shows which project the session belongs to
- Working directory: Read-only display of project's working directory
```

## Form Fields Detail

### Session Name
```
+------------------------------------------------------------------+
| SESSION NAME (optional)                                            |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| |                                                              | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Placeholder: "e.g., Fix login bug"                                 |
| Help text: "Auto-generated if left blank"                          |
| Validation: Max 100 characters                                     |
+------------------------------------------------------------------+
```

### Initial Prompt
```
+------------------------------------------------------------------+
| INITIAL PROMPT *                                        Required   |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| |                                                              | |
| |  (Multiline textarea, min-height: 150px)                     | |
| |                                                              | |
| |  Supports markdown formatting                                | |
| |                                                              | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Placeholder: "Describe what you want Claude to help you with..."   |
| Help text: "Be specific about the task and desired outcome."       |
| Validation: Required, min 10 characters                            |
+------------------------------------------------------------------+
```

### Git Configuration

#### Worktree Selector
```
+------------------------------------------------------------------+
| WORKTREE                                                           |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| | [Main worktree (/Users/dev/project)                      v]  | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Dropdown items:                                                    |
| +--------------------------------------------------------------+ |
| | /Users/dev/project (main)                              [main]| |
| | /Users/dev/project-wt (feature/xyz)             [feature/xyz]| |
| +--------------------------------------------------------------+ |
|                                                                    |
| - Shows only if directory is a git repo with worktrees            |
| - Selecting a worktree updates the effective working directory     |
+------------------------------------------------------------------+
```

#### Branch Selector
```
+------------------------------------------------------------------+
| BRANCH                                                             |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| | [Select branch...                                        v]  | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Dropdown items (grouped):                                          |
| +--------------------------------------------------------------+ |
| | LOCAL BRANCHES                                               | |
| |   * main (current)                                    [HEAD] | |
| |     feature/auth                                             | |
| |     feature/dashboard                                        | |
| | REMOTE BRANCHES                                              | |
| |     origin/main                                     [origin] | |
| |     origin/feature/new-api                          [origin] | |
| +--------------------------------------------------------------+ |
|                                                                    |
| - Current branch marked with asterisk and [HEAD] badge            |
| - Remote branches show remote name as badge                        |
+------------------------------------------------------------------+
```

#### Create New Branch
```
+------------------------------------------------------------------+
| [ ] Create new branch                                              |
+------------------------------------------------------------------+
| When checked:                                                      |
| +--------------------------------------------------------------+ |
| | [x] Create new branch                                        | |
| |                                                              | |
| | Branch name:                                                 | |
| | +----------------------------------------------------------+| |
| | | feature/my-new-feature                                   || |
| | +----------------------------------------------------------+| |
| |                                                              | |
| | Base branch:                                                 | |
| | +----------------------------------------------------------+| |
| | | [main                                                 v] || |
| | +----------------------------------------------------------+| |
| +--------------------------------------------------------------+ |
|                                                                    |
| Validation: Branch name format (no spaces, valid git branch name)  |
+------------------------------------------------------------------+
```

## States

### Loading State (fetching git info)
```
+------------------------------------------------------------------+
| GIT CONFIGURATION                                                  |
| +--------------------------------------------------------------+ |
| |  [Spinner] Loading git information...                        | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### Not a Git Repo
```
+------------------------------------------------------------------+
| GIT CONFIGURATION                                                  |
| +--------------------------------------------------------------+ |
| |  [Info Icon] This directory is not a git repository.         | |
| |  Git features will not be available.                         | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### Validation Errors
```
+------------------------------------------------------------------+
| INITIAL PROMPT *                                        Required   |
| +--------------------------------------------------------------+ |
| |                                                              | |
| +--------------------------------------------------------------+ |
| [!] This field is required                              (red text)|
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

1. **Session Name**
   - Optional text input
   - Auto-generates name from prompt if left blank (e.g., "Session abc123")

2. **Initial Prompt**
   - Required textarea
   - Supports markdown preview (optional toggle)
   - Auto-resizes with content

3. **Worktree Selector**
   - Appears only for git repos
   - Selecting worktree updates effective working directory
   - Shows branch associated with each worktree

4. **Branch Selector**
   - Appears only for git repos
   - Groups local and remote branches
   - Checkmark indicates current branch

5. **Create New Branch**
   - Checkbox to toggle
   - When enabled, shows branch name and base branch inputs
   - Validates branch name format

6. **Cancel Button**
   - Returns to SessionListView for this project
   - Confirms if form has changes (optional)

7. **Create Session Button**
   - Validates all required fields
   - Shows loading state while creating
   - Navigates to SessionDetailView on success
   - Shows error toast on failure

## Execution Mode Note

The execution mode (Plan/Standard/Yolo) is NOT set during session creation.
Instead, users can toggle the mode at any time from the SessionDetailView
when interacting with the session. This allows more flexibility to change
modes as the task evolves.

The default mode for new sessions is "Standard".
