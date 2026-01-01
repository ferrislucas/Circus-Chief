# EditGlobalToolTemplateView Wireframe

The EditGlobalToolTemplateView provides a form for editing or deleting an existing
global tool template. Global tool templates always execute shell commands.

## Full View

```
+------------------------------------------------------------------+
|                                                                    |
|  [<- Back]  Edit Global Tool Template                              |
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
|  COMMAND *                                                         |
|  +--------------------------------------------------------------+ |
|  | [npm test                                                   ] | |
|  +--------------------------------------------------------------+ |
|  The shell command to execute. Arguments entered at runtime        |
|  will be appended to this command.                                 |
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

### Command Field (Payload)
```
+------------------------------------------------------------------+
| COMMAND *                                                Required  |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| | [Current command                                            ] | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Pre-filled with existing value                                     |
| Validation: Required, max 500 characters                           |
+------------------------------------------------------------------+
```

## States

### Loading State (fetching tool data)
```
+------------------------------------------------------------------+
| [<- Back]  Edit Global Tool Template                               |
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
   - Returns to ToolsGlobalView
   - Confirms if form has unsaved changes

2. **Name Input**
   - Pre-filled with existing value
   - Validates on blur

3. **Command Input**
   - Pre-filled with existing value
   - Validates on blur

4. **Cancel Button**
   - Returns to ToolsGlobalView
   - Confirms if form has unsaved changes

5. **Save Changes Button**
   - Validates all required fields
   - Shows loading state while saving
   - On success: Navigates to ToolsGlobalView with success toast
   - On failure: Shows error message, form remains editable

6. **Delete Tool Button**
   - Opens confirmation modal
   - Modal has Cancel and Delete buttons
   - Delete shows loading state while deleting
   - On success: Navigates to ToolsGlobalView with deletion toast
   - On failure: Shows error message in modal

## API Requests

### Update Tool
```
PUT /api/tools/:id
{
  "name": "Run Tests",
  "payload": "npm test"
}
```

### Delete Tool
```
DELETE /api/tools/:id
```

## Responsive Behavior

### Mobile (<768px)
- Full-width form fields
- Delete button stacks above Cancel/Save
- Modal is full-width with padding

### Tablet/Desktop (>768px)
- Centered form with max-width container
- Delete button aligned left, Cancel/Save aligned right
- Modal centered with max-width
