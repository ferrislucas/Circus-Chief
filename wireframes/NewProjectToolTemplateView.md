# NewProjectToolTemplateView Wireframe

The NewProjectToolTemplateView provides a form for creating a new project tool template.
Project tool templates can be either "command" type (execute shell commands) or "prompt"
type (populate the session message input).

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  New Project Tool Template                              |
|             Project: My Web App                                    |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Create a tool template for sessions in this project.              |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  NAME *                                                            |
|  +--------------------------------------------------------------+ |
|  | [e.g., Run Tests                                            ] | |
|  +--------------------------------------------------------------+ |
|  A short, descriptive name for this tool                          |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  TYPE *                                                            |
|  +--------------------------------------------------------------+ |
|  | ( ) Command - Executes a shell command in the background      | |
|  | (o) Prompt  - Populates the session message input             | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  PAYLOAD *                                                         |
|  +--------------------------------------------------------------+ |
|  | [e.g., npm test                                             ] | |
|  +--------------------------------------------------------------+ |
|  The command to execute or prompt text to insert.                  |
|  Runtime arguments will be appended.                               |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|                                              [Cancel]  [Create Tool]|
|                                                                    |
+------------------------------------------------------------------+
```

## Form Fields Detail

### Name Field
```
+------------------------------------------------------------------+
| NAME *                                                   Required  |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| |                                                              | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Placeholder: "e.g., Run Tests"                                    |
| Help text: "A short, descriptive name for this tool"              |
| Validation: Required, max 50 characters                            |
+------------------------------------------------------------------+
```

### Type Field
```
+------------------------------------------------------------------+
| TYPE *                                                   Required  |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| | ( ) Command - Executes a shell command in the background      | |
| | (o) Prompt  - Populates the session message input             | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Radio button group, default: "prompt"                              |
| Help text changes based on selection:                              |
| - Command: "Runs in background, won't block UI"                   |
| - Prompt: "Puts text in message input, switches to Conversation"  |
+------------------------------------------------------------------+
```

### Payload Field
```
+------------------------------------------------------------------+
| PAYLOAD *                                                Required  |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| |                                                              | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Placeholder changes based on type:                                 |
| - Command: "e.g., npm test"                                       |
| - Prompt: "e.g., Review this code for security issues"            |
|                                                                    |
| Help text: "The command to execute or prompt text to insert.       |
|             Runtime arguments will be appended."                   |
| Validation: Required, max 1000 characters                          |
| For prompt type, consider multiline textarea                       |
+------------------------------------------------------------------+
```

## States

### Validation Errors
```
+------------------------------------------------------------------+
| NAME *                                                   Required  |
| +--------------------------------------------------------------+ |
| |                                                              | |
| +--------------------------------------------------------------+ |
| [!] This field is required                              (red text)|
+------------------------------------------------------------------+

+------------------------------------------------------------------+
| PAYLOAD *                                                Required  |
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

### Error State (API failure)
```
+------------------------------------------------------------------+
|  [!] Failed to create tool template. Please try again.            |
+------------------------------------------------------------------+
|                                                                    |
|                                              [Cancel]  [Create Tool]|
|                                                                    |
+------------------------------------------------------------------+
```

## Interactions

1. **Back Button**
   - Returns to ProjectEditView
   - Confirms if form has unsaved changes

2. **Name Input**
   - Required text input
   - Focus on page load
   - Validates on blur

3. **Type Radio Buttons**
   - Select between "command" and "prompt"
   - Changes placeholder and help text for payload field
   - Default: "prompt"

4. **Payload Input**
   - Required text input (or textarea for prompt type)
   - Placeholder changes based on type selection
   - Validates on blur

5. **Cancel Button**
   - Returns to ProjectEditView
   - Confirms if form has unsaved changes

6. **Create Tool Button**
   - Validates all required fields
   - Shows loading state while creating
   - On success: Navigates to ProjectEditView with tools section
   - On failure: Shows error message, form remains editable

## API Request

```
POST /api/projects/:projectId/tools
{
  "name": "Run Tests",
  "payload": "npm test",
  "payloadType": "command"  // or "prompt"
}
```

## Responsive Behavior

### Mobile (<768px)
- Full-width form fields
- Radio buttons stack vertically
- Buttons stack vertically on narrow screens

### Tablet/Desktop (>768px)
- Centered form with max-width container
- Radio buttons in single row
- Buttons aligned to right
