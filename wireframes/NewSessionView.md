# NewSessionView Wireframe

The NewSessionView provides a form for creating a new Claude Code session.
It includes fields for the prompt, working directory, and optional git configuration.

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  New Session                                            |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Create a new Claude Code session to start working on a task.      |
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
|  WORKING DIRECTORY *                                               |
|  +--------------------------------------------------------------+ |
|  | [/Users/developer/projects/my-app               ] [Browse]   | |
|  +--------------------------------------------------------------+ |
|  Where Claude will execute commands and make changes.              |
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
|  |  |  /Users/developer/projects/my-app (main)                 || |
|  |  |  /Users/developer/projects/my-app-feature                || |
|  |  |  /Users/developer/projects/my-app-hotfix                 || |
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

### Working Directory
```
+------------------------------------------------------------------+
| WORKING DIRECTORY *                                     Required   |
+------------------------------------------------------------------+
| +---------------------------------------------------+ +--------+ |
| | /path/to/directory                                | | Browse | |
| +---------------------------------------------------+ +--------+ |
|                                                                    |
| Help text: "Where Claude will execute commands and make changes."  |
| Validation: Must be valid absolute path, must exist                |
| Browse button: Opens system file picker (if supported)             |
+------------------------------------------------------------------+

Recent directories (shown below input):
+------------------------------------------------------------------+
| Recent:                                                            |
| [/Users/dev/project-a] [/Users/dev/project-b] [/Users/dev/work]   |
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
| - Selecting a worktree updates the working directory               |
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

1. **Session Name**
   - Optional text input
   - Auto-generates name from prompt if left blank (e.g., "Session abc123")

2. **Initial Prompt**
   - Required textarea
   - Supports markdown preview (optional toggle)
   - Auto-resizes with content

3. **Working Directory**
   - Required text input
   - Browse button opens file picker dialog
   - Validates path exists on blur
   - Recent directories shown as quick-select chips

4. **Worktree Selector**
   - Appears only for git repos
   - Selecting worktree updates working directory path
   - Shows branch associated with each worktree

5. **Branch Selector**
   - Appears only for git repos
   - Groups local and remote branches
   - Checkmark indicates current branch

6. **Create New Branch**
   - Checkbox to toggle
   - When enabled, shows branch name and base branch inputs
   - Validates branch name format

7. **Cancel Button**
   - Returns to SessionListView
   - Confirms if form has changes (optional)

8. **Create Session Button**
   - Validates all required fields
   - Shows loading state while creating
   - Navigates to SessionDetailView on success
   - Shows error toast on failure
