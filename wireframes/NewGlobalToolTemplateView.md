# NewGlobalToolTemplateView Wireframe

The NewGlobalToolTemplateView provides a form for creating a new global tool template.
Global tool templates always execute shell commands (payloadType is always "command").

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  New Global Tool Template                               |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  Create a tool template to run shell commands from any session.    |
|  Commands run in background processes and won't block the UI.      |
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
|  COMMAND *                                                         |
|  +--------------------------------------------------------------+ |
|  | [e.g., npm test                                             ] | |
|  +--------------------------------------------------------------+ |
|  The shell command to execute. Arguments entered at runtime        |
|  will be appended to this command.                                 |
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

### Command Field (Payload)
```
+------------------------------------------------------------------+
| COMMAND *                                                Required  |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| |                                                              | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Placeholder: "e.g., npm test"                                     |
| Help text: "The shell command to execute. Arguments entered at     |
|             runtime will be appended to this command."             |
| Validation: Required, max 500 characters                           |
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
| COMMAND *                                                Required  |
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
   - Returns to ToolsGlobalView
   - Confirms if form has unsaved changes

2. **Name Input**
   - Required text input
   - Focus on page load
   - Validates on blur

3. **Command Input**
   - Required text input
   - Single line for simple commands
   - Validates on blur

4. **Cancel Button**
   - Returns to ToolsGlobalView
   - Confirms if form has unsaved changes

5. **Create Tool Button**
   - Validates all required fields
   - Shows loading state while creating
   - On success: Navigates to ToolsGlobalView
   - On failure: Shows error message, form remains editable

## API Request

```
POST /api/tools
{
  "name": "Run Tests",
  "payload": "npm test",
  "payloadType": "command"  // Always "command" for global tools
}
```

## Responsive Behavior

### Mobile (<768px)
- Full-width form fields
- Buttons stack vertically on narrow screens

### Tablet/Desktop (>768px)
- Centered form with max-width container
- Buttons aligned to right
