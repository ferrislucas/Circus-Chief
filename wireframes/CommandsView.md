# CommandsView Wireframe

The CommandsView displays all available slash commands organized by source (built-in, project, user).
Users can browse, search, create, edit, and delete custom commands.

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  SLASH COMMANDS                                   [+ New Command]  |
|                                                                    |
|  Browse and manage slash commands available in your sessions.      |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Search: [Search commands...________________]                      |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  BUILT-IN COMMANDS                                                 |
|  +--------------------------------------------------------------+ |
|  |  /help                                                       | |
|  |  Show available commands and help information     [builtin]  | |
|  +--------------------------------------------------------------+ |
|  |  /clear                                                      | |
|  |  Clear conversation history                       [builtin]  | |
|  +--------------------------------------------------------------+ |
|  |  /model                                                      | |
|  |  Change the AI model (sonnet, opus, haiku)        [builtin]  | |
|  +--------------------------------------------------------------+ |
|  |  /status                                                     | |
|  |  Show session status and statistics               [builtin]  | |
|  +--------------------------------------------------------------+ |
|  |  /cost                                                       | |
|  |  Show token usage and cost estimates              [builtin]  | |
|  +--------------------------------------------------------------+ |
|  |  /compact                                                    | |
|  |  Compact/summarize conversation history           [builtin]  | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  PROJECT COMMANDS (.claude/commands/)                              |
|  +--------------------------------------------------------------+ |
|  |  /fix-issue                                                  | |
|  |  Fix a GitHub issue by number                     [project]  | |
|  |  Arguments: issue-number (required)                          | |
|  +--------------------------------------------------------------+ |
|  |  /optimize                                                   | |
|  |  Optimize code for performance                    [project]  | |
|  |  Arguments: file-path (optional)                             | |
|  +--------------------------------------------------------------+ |
|  |  /review-pr                                                  | |
|  |  Review a pull request                            [project]  | |
|  |  Arguments: pr-number (required)                             | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  PERSONAL COMMANDS (~/.claude/commands/)                           |
|  +--------------------------------------------------------------+ |
|  |  /security-review                                 [Edit][X]  | |
|  |  Perform security audit on the codebase           [user]     | |
|  +--------------------------------------------------------------+ |
|  |  /my-workflow                                     [Edit][X]  | |
|  |  Run my personal development workflow             [user]     | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Command Card Component

### Built-in Command Card (read-only)
```
+------------------------------------------------------------------+
|  /command-name                                                     |
|  Description of what this command does              [builtin]      |
+------------------------------------------------------------------+
```

### Custom Command Card (editable)
```
+------------------------------------------------------------------+
|  /command-name                                       [Edit] [X]    |
|  Description of what this command does              [project]      |
|  Arguments: arg1 (required), arg2 (optional)                       |
+------------------------------------------------------------------+

Badges:
- [builtin] - Gray badge, system commands
- [project] - Blue badge, team-shared commands
- [user]    - Purple badge, personal commands
```

## Command Detail Panel (sidebar or modal)

```
+------------------------------------------------------------------+
|  /fix-issue                                                        |
+------------------------------------------------------------------+
|                                                                    |
|  DESCRIPTION                                                       |
|  Fix a GitHub issue by number. Analyzes the issue, finds           |
|  relevant code, implements the fix, and adds tests.                |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  ARGUMENTS                                                         |
|  +--------------------------------------------------------------+ |
|  | issue-number    Required    GitHub issue number to fix       | |
|  | priority        Optional    Priority level (low/med/high)    | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  SOURCE                                                            |
|  .claude/commands/fix-issue.md                          [project]  |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  CONFIGURATION                                                     |
|  Model: claude-sonnet-4-5                                          |
|  Allowed tools: Bash(enabled)                                      |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  PROMPT CONTENT                                                    |
|  +--------------------------------------------------------------+ |
|  | Fix issue #$ARGUMENTS by:                                    | |
|  | 1. Reading and understanding the issue                       | |
|  | 2. Locating relevant code in the codebase                    | |
|  | 3. Implementing a fix that addresses the issue               | |
|  | 4. Adding appropriate tests                                  | |
|  | 5. Verifying the fix works                                   | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  USAGE EXAMPLE                                                     |
|  /fix-issue 123                                                    |
|                                                                    |
+------------------------------------------------------------------+
```

## New/Edit Command Form

```
+------------------------------------------------------------------+
|  CREATE NEW COMMAND                                    [X] Close   |
+------------------------------------------------------------------+
|                                                                    |
|  COMMAND NAME *                                                    |
|  +--------------------------------------------------------------+ |
|  | my-command                                                   | |
|  +--------------------------------------------------------------+ |
|  Will be invoked as /my-command                                    |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  DESCRIPTION *                                                     |
|  +--------------------------------------------------------------+ |
|  | Brief description of what this command does                  | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  ARGUMENT HINT                                                     |
|  +--------------------------------------------------------------+ |
|  | file-path (required), options (optional)                     | |
|  +--------------------------------------------------------------+ |
|  Describe expected arguments for users                             |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  PROMPT CONTENT *                                                  |
|  +--------------------------------------------------------------+ |
|  | Use $ARGUMENTS to reference user-provided arguments.         | |
|  |                                                              | |
|  | Example:                                                     | |
|  | Analyze the file at $ARGUMENTS and suggest improvements.     | |
|  |                                                              | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|  Supports markdown. Use $ARGUMENTS placeholder for user input.     |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  SAVE LOCATION                                                     |
|  ( ) Project (.claude/commands/) - shared with team                |
|  (*) Personal (~/.claude/commands/) - private to you               |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  ADVANCED OPTIONS (collapsed by default)                           |
|  +--------------------------------------------------------------+ |
|  | Model override:                                              | |
|  | [Default (inherit from session)              v]              | |
|  |                                                              | |
|  | Allowed tools:                                               | |
|  | [x] Bash  [x] Read  [x] Edit  [x] Write  [x] Glob  [x] Grep  | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|                                            [Cancel]  [Save Command]|
|                                                                    |
+------------------------------------------------------------------+
```

## Empty States

### No Commands Found (search)
```
+------------------------------------------------------------------+
|                                                                    |
|                      [Search Icon]                                 |
|                                                                    |
|              No commands match "xyz"                               |
|                                                                    |
|        Try a different search term or create a new command.        |
|                                                                    |
+------------------------------------------------------------------+
```

### No Custom Commands
```
+------------------------------------------------------------------+
|                                                                    |
|  PERSONAL COMMANDS (~/.claude/commands/)                           |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |  No personal commands yet.                                   | |
|  |                                                              | |
|  |  Create custom commands to automate your workflows.          | |
|  |                                                              | |
|  |                    [+ Create Command]                        | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

## Command Palette (in MessageInput)

When user types `/` in the message input:

```
+------------------------------------------------------------------+
|                                                                    |
|  [/fix                                               ] [Send]      |
|                                                                    |
+------------------------------------------------------------------+
|  +--------------------------------------------------------------+ |
|  | > /fix-issue           Fix a GitHub issue          [project] | |  <- Selected
|  |   /fix-typo            Fix typos in documentation  [project] | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  Showing 2 of 15 commands. Keep typing to filter.                  |
|  [Up/Down] Navigate  [Enter] Select  [Esc] Cancel                  |
+------------------------------------------------------------------+
```

### Palette States

#### Initial (just typed `/`)
```
+--------------------------------------------------------------+
| RECENT                                                        |
|   /fix-issue         Fix a GitHub issue              [project]|
|   /model             Change the model                [builtin]|
|                                                               |
| ALL COMMANDS                                                  |
|   /clear             Clear history                   [builtin]|
|   /compact           Compact conversation            [builtin]|
|   /cost              Show token usage                [builtin]|
|   /fix-issue         Fix a GitHub issue              [project]|
|   ...                                                         |
+--------------------------------------------------------------+
```

#### Filtered (typing filter text)
```
+--------------------------------------------------------------+
| Showing 3 matches for "fix"                                   |
|                                                               |
|   /fix-issue         Fix a GitHub issue              [project]|
|   /fix-typo          Fix typos in docs               [project]|
|   /fix-tests         Fix failing tests               [user]   |
+--------------------------------------------------------------+
```

#### With Arguments Preview
```
+--------------------------------------------------------------+
| > /fix-issue 123                                              |
+--------------------------------------------------------------+
| /fix-issue <issue-number>                                     |
|                                                               |
| Fix a GitHub issue by number. Analyzes the issue, finds       |
| relevant code, implements the fix, and adds tests.            |
|                                                               |
| Press [Enter] to execute                                      |
+--------------------------------------------------------------+
```

## Interactions

1. **Search**
   - Real-time filtering as user types
   - Searches command names and descriptions

2. **Command Card Click**
   - Opens detail panel/modal with full information
   - Shows prompt content and configuration

3. **Edit Button**
   - Opens edit form (same as create, pre-filled)
   - Only available for custom commands (project/user)

4. **Delete Button [X]**
   - Confirmation dialog: "Delete /command-name?"
   - Only available for custom commands
   - Removes file from disk

5. **New Command Button**
   - Opens create form modal
   - Validates unique command name

6. **Command Palette**
   - Triggered by `/` at start of message
   - Arrow keys to navigate
   - Enter to select command
   - Tab to insert command without executing
   - Escape to close

7. **Source Badge Click**
   - Optional: Navigate to file location
   - Shows full path tooltip on hover

## Real-time Updates

- Commands list updates when files are created/deleted
- WebSocket broadcasts command changes
- New commands appear with animation
