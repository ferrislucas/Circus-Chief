# EditProjectToolTemplateView Wireframe

The EditProjectToolTemplateView provides a form for editing or deleting an existing
project tool template. Project tool templates can be either "command" type (execute
shell commands) or "prompt" type (populate the session message input).

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  Edit Project Tool Template                             |
|             Project: My Web App                                    |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  NAME *                                                            |
|  +--------------------------------------------------------------+ |
|  | [Run Tests                                                  ] | |
|  +--------------------------------------------------------------+ |
|  A short, descriptive name for this tool                          |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  TYPE *                                                            |
|  +--------------------------------------------------------------+ |
|  | (o) Command - Executes a shell command in the background      | |
|  | ( ) Prompt  - Populates the session message input             | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  PAYLOAD *                                                         |
|  +--------------------------------------------------------------+ |
|  | [npm test                                                   ] | |
|  +--------------------------------------------------------------+ |
|  The command to execute or prompt text to insert.                  |
|  Runtime arguments will be appended.                               |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  [Delete Tool]                         [Cancel]  [Save Changes]    |
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
| | [Current tool name                                          ] | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Pre-filled with existing value                                     |
| Validation: Required, max 50 characters                            |
+------------------------------------------------------------------+
```

### Type Field
```
+------------------------------------------------------------------+
| TYPE *                                                   Required  |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| | (o) Command - Executes a shell command in the background      | |
| | ( ) Prompt  - Populates the session message input             | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Pre-selected based on existing payloadType                         |
| Changing type will update help text for payload field              |
+------------------------------------------------------------------+
```

### Payload Field
```
+------------------------------------------------------------------+
| PAYLOAD *                                                Required  |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| | [Current payload                                            ] | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Pre-filled with existing value                                     |
| Validation: Required, max 1000 characters                          |
| For prompt type, consider multiline textarea                       |
+------------------------------------------------------------------+
```

## States

### Loading State (fetching tool data)
```
+------------------------------------------------------------------+
| [<- Back]  Edit Project Tool Template                              |
|            Project: My Web App                                     |
+------------------------------------------------------------------+
|                                                                    |
|  [Spinner] Loading tool template...                                |
|                                                                    |
+------------------------------------------------------------------+
```

### Validation Errors
```
+------------------------------------------------------------------+
| NAME *                                                   Required  |
| +--------------------------------------------------------------+ |
| |                                                              | |
| +--------------------------------------------------------------+ |
| [!] This field is required                              (red text)|
+------------------------------------------------------------------+
```

### Submitting State (Save)
```
+------------------------------------------------------------------+
|                                                                    |
|  [Delete Tool]                         [Cancel]  [Saving...] (disabled)|
|                                                    [Spinner]       |
+------------------------------------------------------------------+
```

### Delete Confirmation Modal
```
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |                                                              | |
|  |                    Delete Tool Template?                      | |
|  |                                                              | |
|  |  Are you sure you want to delete "Run Tests"?                | |
|  |  This action cannot be undone.                               | |
|  |                                                              | |
|  |                              [Cancel]  [Delete]              | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

### Deleting State
```
+------------------------------------------------------------------+
|  |                                                              | |
|  |                              [Cancel]  [Deleting...] (disabled)| |
|  |                                         [Spinner]            | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### Error State (API failure)
```
+------------------------------------------------------------------+
|  [!] Failed to save changes. Please try again.                    |
+------------------------------------------------------------------+
|                                                                    |
|  [Delete Tool]                         [Cancel]  [Save Changes]    |
|                                                                    |
+------------------------------------------------------------------+
```

## Interactions

1. **Back Button**
   - Returns to ProjectEditView with tools section
   - Confirms if form has unsaved changes

2. **Name Input**
   - Pre-filled with existing value
   - Validates on blur

3. **Type Radio Buttons**
   - Pre-selected based on existing payloadType
   - Changing updates help text for payload field
   - May prompt user if changing type with existing payload

4. **Payload Input**
   - Pre-filled with existing value
   - Input type may change between single line and textarea based on type

5. **Cancel Button**
   - Returns to ProjectEditView with tools section
   - Confirms if form has unsaved changes

6. **Save Changes Button**
   - Validates all required fields
   - Shows loading state while saving
   - On success: Navigates to ProjectEditView with success toast
   - On failure: Shows error message, form remains editable

7. **Delete Tool Button**
   - Opens confirmation modal
   - Modal has Cancel and Delete buttons
   - Delete shows loading state while deleting
   - On success: Navigates to ProjectEditView with deletion toast
   - On failure: Shows error message in modal

## API Requests

### Update Tool
```
PUT /api/projects/:projectId/tools/:toolId
{
  "name": "Run Tests",
  "payload": "npm test",
  "payloadType": "command"
}
```

### Delete Tool
```
DELETE /api/projects/:projectId/tools/:toolId
```

## Responsive Behavior

### Mobile (<768px)
- Full-width form fields
- Radio buttons stack vertically
- Delete button stacks above Cancel/Save
- Modal is full-width with padding

### Tablet/Desktop (>768px)
- Centered form with max-width container
- Radio buttons in single row
- Delete button aligned left, Cancel/Save aligned right
- Modal centered with max-width
