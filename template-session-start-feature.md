# Template Session Start Feature Plan

## Overview
Enable users to select a template when starting a new session, which populates all form fields (prompt, model, mode, thinking enabled, git settings, next template) but does NOT auto-start the session. The user must still click the "Start Session" button.

Also, add the ability to select the model (and mode) when managing templates, which should be honored when starting a session with a template or when a template is invoked via "next template".

---

## UI Clarification: Two Different Template Selectors

**IMPORTANT**: The new "Start From Template" selector is a **completely separate UI element** from the existing "Session Template (optional)" dropdown.

| UI Element | Purpose | Location | Action |
|------------|---------|----------|--------|
| **NEW: "Start From Template"** | Pre-populates form fields from a template | Top of form, before prompt | Fills prompt, mode, model, thinking, git, AND sets the next template field |
| **EXISTING: "Session Template (optional)"** | Sets which template to auto-start AFTER this session completes | Bottom of form | Renamed to "Next Template" for clarity |

---

## Wireframes

### Current New Session View
```
┌─────────────────────────────────────────────────────────────┐
│  ← Sessions                                                 │
│  New Session                                                │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Quick Responses: [btn1] [btn2] [btn3]               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  What would you like Claude to help you with?       │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  [📎 Attach] [/ Commands]                                  │
│                                                             │
│  Options                                                    │
│  [Mode ▼] [Model ▼] [☑ Thinking] [☑ Start Immediately]     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              [ Start Session ]                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Git Options                                                │
│  ○ Create isolated worktree                                │
│  ○ Create new branch                                       │
│  ○ Use current branch (main)                               │
│                                                             │
│  Session Template (optional)           <-- CONFUSING NAME   │
│  [None - single session         ▼]                          │
│  (Sets the next template after session completes)           │
│                                                             │
│  Parent Session (optional)                                  │
│  [None - create standalone ▼]                               │
└─────────────────────────────────────────────────────────────┘
```

### Proposed New Session View (with "Start From Template")
```
┌─────────────────────────────────────────────────────────────┐
│  ← Sessions                                                 │
│  New Session                                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Start From Template (optional)                      │   │
│  │ [Select a template to pre-fill the form...      ▼]  │   │
│  │ Selecting a template will populate all fields below │   │
│  └─────────────────────────────────────────────────────┘   │
│                                     ▲                       │
│                                     │                       │
│                          NEW UI ELEMENT                     │
│                          Fills ALL fields below             │
│                                     │                       │
│                                     ▼                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Quick Responses: [btn1] [btn2] [btn3]               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  [Pre-filled prompt from template OR user input]    │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  [📎 Attach] [/ Commands]                                  │
│                                                             │
│  Options                                                    │
│  [Mode ▼] [Model ▼] [☑ Thinking] [☑ Start Immediately]     │
│   ▲         ▲        ▲                                      │
│   └─────────┴────────┴── All populated from template        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              [ Start Session ]                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Git Options  ◄── Also populated from template              │
│  ● Create isolated worktree                                │
│  ○ Create new branch                                       │
│  ○ Use current branch (main)                               │
│  Branch Name: [claude-tools/feature-xyz]                   │
│                                                             │
│  Next Template (optional)          <-- RENAMED FOR CLARITY  │
│  [Template B                    ▼]  ◄── Also populated      │
│  (After this session completes, Template B will auto-start) │
│                                                             │
│  Parent Session (optional)                                  │
│  [None - create standalone ▼]                               │
└─────────────────────────────────────────────────────────────┘
```

### Template Management Panel (adding Model & Mode)
```
┌─────────────────────────────────────────────────────────────┐
│  Templates                                    [+ New]       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Template Form:                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Name                                                 │   │
│  │ [Template Name                                   ]   │   │
│  │                                                     │   │
│  │ Prompt                                              │   │
│  │ ┌─────────────────────────────────────────────┐    │   │
│  │ │ The prompt text...                          │    │   │
│  │ └─────────────────────────────────────────────┘    │   │
│  │                                                     │   │
│  │ Scope                                               │   │
│  │ ○ Global  ○ This Project Only                       │   │
│  │                                                     │   │
│  │ Next Template                                       │   │
│  │ [None                                          ▼]   │   │
│  │                                                     │   │
│  │ ┌─────────────────────────────────────────────┐    │   │
│  │ │ Model                           ◄── NEW      │    │   │
│  │ │ [Claude Sonnet 4                         ▼] │    │   │
│  │ └─────────────────────────────────────────────┘    │   │
│  │                                                     │   │
│  │ ┌─────────────────────────────────────────────┐    │   │
│  │ │ Mode                            ◄── NEW      │    │   │
│  │ │ [YOLO                                    ▼] │    │   │
│  │ └─────────────────────────────────────────────┘    │   │
│  │                                                     │   │
│  │ [☑] Enable Thinking                                 │   │
│  │                                                     │   │
│  │ Git Branch                                          │   │
│  │ [feature-branch-name                         ]      │   │
│  │                                                     │   │
│  │ Git Mode                                            │   │
│  │ [Worktree                                    ▼]     │   │
│  │                                                     │   │
│  │           [Cancel]  [Save Template]                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Template Cards:                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 📄 Code Review Template                   [Edit][X] │   │
│  │ "Review the code changes..."                        │   │
│  │ [Global] [Sonnet] [YOLO] [Thinking] [main]          │   │
│  │         ▲          ▲                                │   │
│  │         └──────────┴── NEW badges for model & mode  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Current State Analysis

### Database (`session_templates` table)
Current columns:
- `id`, `project_id`, `name`, `prompt`, `next_template_id`, `thinking_enabled`, `git_branch`, `git_mode`, `created_at`, `updated_at`

**MISSING**: `model` and `mode` columns

### Template Creation/Editing (`TemplatesPanel.vue`)
Current fields:
- Name, Prompt, Scope, Next Template, Thinking Enabled, Git Branch

**MISSING**: Model selector, Mode selector

### Template Triggering (`templateTriggerService.js`)
When a template triggers, it currently:
- Inherits `thinkingEnabled` from template if set, else from parent
- Inherits `gitBranch` from template or parent
- Inherits `mode` from parent session (NOT from template)

**MISSING**: Model inheritance from template

### New Session View (`NewSessionView.vue`)
- Has "Session Template (optional)" dropdown that sets `templateId` (for chaining to next template)
- Template selection does NOT populate form fields
- **MISSING**: "Start From Template" selector to pre-populate form

---

## Implementation Plan

### Phase 1: Database Schema Changes

#### 1.1 Add Migration for `model` and `mode` columns
**File**: `packages/server/src/db/migrations/add_template_model_mode.sql`

```sql
-- Add model column to session_templates
ALTER TABLE session_templates ADD COLUMN model TEXT DEFAULT 'claude-sonnet-4-20250514';

-- Add mode column to session_templates
ALTER TABLE session_templates ADD COLUMN mode TEXT DEFAULT 'yolo' CHECK(mode IN ('plan', 'standard', 'yolo'));

-- Update existing templates to have default values if needed
UPDATE session_templates SET model = 'claude-sonnet-4-20250514' WHERE model IS NULL;
UPDATE session_templates SET mode = 'yolo' WHERE mode IS NULL;
```

#### 1.2 Update Schema
**File**: `packages/server/src/schema.sql`

Add columns to `session_templates` table definition:
```sql
model TEXT DEFAULT 'claude-sonnet-4-20250514',
mode TEXT DEFAULT 'yolo' CHECK(mode IN ('plan', 'standard', 'yolo')),
```

---

### Phase 2: Backend Changes

#### 2.1 Update Zod Contracts
**File**: `packages/shared/src/contracts/templates.js`

```javascript
export const CreateSessionTemplateRequest = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  nextTemplateId: z.string().uuid().nullable().optional(),
  thinkingEnabled: z.boolean().nullable().optional(),
  gitBranch: z.string().nullable().optional(),
  gitMode: z.enum(['branch', 'worktree']).nullable().optional(),
  model: z.string().optional(), // NEW
  mode: z.enum(['plan', 'standard', 'yolo']).optional(), // NEW
});

export const UpdateSessionTemplateRequest = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  nextTemplateId: z.string().uuid().nullable().optional(),
  thinkingEnabled: z.boolean().nullable().optional(),
  gitBranch: z.string().nullable().optional(),
  gitMode: z.enum(['branch', 'worktree']).nullable().optional(),
  model: z.string().optional(), // NEW
  mode: z.enum(['plan', 'standard', 'yolo']).optional(), // NEW
});

export const SessionTemplateResponse = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  name: z.string(),
  prompt: z.string(),
  nextTemplateId: z.string().uuid().nullable(),
  thinkingEnabled: z.boolean().nullable(),
  gitBranch: z.string().nullable(),
  gitMode: z.string().nullable(),
  model: z.string().nullable(), // NEW
  mode: z.string().nullable(), // NEW
  createdAt: z.number(),
  updatedAt: z.number(),
});
```

#### 2.2 Update SessionTemplateRepository
**File**: `packages/server/src/db/SessionTemplateRepository.js`

Update `#mapTemplate`:
```javascript
static #mapTemplate(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    prompt: row.prompt,
    nextTemplateId: row.next_template_id,
    thinkingEnabled: row.thinking_enabled === null ? null : Boolean(row.thinking_enabled),
    gitBranch: row.git_branch,
    gitMode: row.git_mode,
    model: row.model, // NEW
    mode: row.mode, // NEW
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

Update `create()` method:
```javascript
create(data) {
  const id = databaseManager.generateId();
  const now = Date.now();
  this.db
    .prepare(
      `INSERT INTO session_templates (id, project_id, name, prompt, next_template_id, thinking_enabled, git_branch, git_mode, model, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.projectId || null,
      data.name,
      data.prompt,
      data.nextTemplateId || null,
      data.thinkingEnabled === null || data.thinkingEnabled === undefined ? null : (data.thinkingEnabled ? 1 : 0),
      data.gitBranch || null,
      data.gitMode || null,
      data.model || 'claude-sonnet-4-20250514', // NEW
      data.mode || 'yolo', // NEW
      now,
      now
    );
  return this.getById(id);
}
```

Update `update()` method:
```javascript
update(id, data) {
  const updates = [];
  const values = [];

  // ... existing fields ...

  if (data.model !== undefined) { // NEW
    updates.push('model = ?');
    values.push(data.model);
  }
  if (data.mode !== undefined) { // NEW
    updates.push('mode = ?');
    values.push(data.mode);
  }

  // ... rest of update logic ...
}
```

#### 2.3 Update templateTriggerService
**File**: `packages/server/src/services/templateTriggerService.js`

Update the template trigger logic to use model and mode from template:

```javascript
// Determine settings: use template overrides if set, otherwise inherit from parent session
const thinkingEnabled = template.thinkingEnabled !== null ? template.thinkingEnabled : session.thinkingEnabled;
const gitBranch = template.gitBranch || session.gitBranch;
const gitMode = template.gitMode || null;
const model = template.model || session.model; // NEW
const mode = template.mode || session.mode; // NEW
```

Update session creation:
```javascript
// Create the new session
const newSession = sessions.create(
  session.projectId,
  newSessionName,
  renderedPrompt,
  mode, // Use mode from template or parent
  thinkingEnabled,
  gitBranch
);

// Add model to session update
sessions.update(newSession.id, {
  parentSessionId: session.id,
  nextTemplateId: template.nextTemplateId || null,
  model, // NEW - set model from template
});
```

---

### Phase 3: Frontend Changes

#### 3.1 Update TemplatesPanel.vue
**File**: `packages/web/src/components/TemplatesPanel.vue`

Add imports:
```javascript
import { CLAUDE_MODELS } from '@claudetools/shared';
```

Add to template form (after "Next Template" field, before "Git Branch"):
```vue
<div class="form-group">
  <label class="form-label">Model</label>
  <select v-model="formData.model" class="form-input">
    <option v-for="m in CLAUDE_MODELS" :key="m.id" :value="m.id">
      {{ m.name }}
    </option>
  </select>
</div>

<div class="form-group">
  <label class="form-label">Mode</label>
  <select v-model="formData.mode" class="form-input">
    <option value="plan">Plan</option>
    <option value="standard">Standard</option>
    <option value="yolo">YOLO</option>
  </select>
</div>
```

Update form data initialization:
```javascript
const formData = ref({
  name: '',
  prompt: '',
  isGlobal: false,
  nextTemplateId: null,
  thinkingEnabled: false,
  gitBranch: '',
  model: 'claude-sonnet-4-20250514', // NEW
  mode: 'yolo', // NEW
});
```

Update `resetForm()`:
```javascript
function resetForm() {
  formData.value = {
    name: '',
    prompt: '',
    isGlobal: false,
    nextTemplateId: null,
    thinkingEnabled: false,
    gitBranch: '',
    model: 'claude-sonnet-4-20250514', // NEW
    mode: 'yolo', // NEW
  };
  editingTemplate.value = null;
}
```

Update `editTemplate()`:
```javascript
function editTemplate(template) {
  editingTemplate.value = template;
  formData.value = {
    name: template.name,
    prompt: template.prompt,
    isGlobal: !template.projectId,
    nextTemplateId: template.nextTemplateId || null,
    thinkingEnabled: template.thinkingEnabled || false,
    gitBranch: template.gitBranch || '',
    model: template.model || 'claude-sonnet-4-20250514', // NEW
    mode: template.mode || 'yolo', // NEW
  };
  showCreateForm.value = true;
}
```

Update `handleSubmit()`:
```javascript
async function handleSubmit() {
  if (saving.value) return;

  saving.value = true;
  try {
    const data = {
      name: formData.value.name,
      prompt: formData.value.prompt,
      nextTemplateId: formData.value.nextTemplateId || undefined,
      thinkingEnabled: formData.value.thinkingEnabled || undefined,
      gitBranch: formData.value.gitBranch || undefined,
      model: formData.value.model || undefined, // NEW
      mode: formData.value.mode || undefined, // NEW
    };

    // ... rest of submit logic ...
  }
}
```

Update template card display to show model/mode badges:
```vue
<div class="template-meta">
  <span class="meta-badge meta-badge-global">Global</span>
  <span v-if="template.thinkingEnabled" class="meta-badge">Thinking</span>
  <span v-if="template.gitBranch" class="meta-badge">{{ template.gitBranch }}</span>
  <span v-if="template.model" class="meta-badge">{{ getModelName(template.model) }}</span>
  <span v-if="template.mode" class="meta-badge">{{ template.mode }}</span>
  <span v-if="template.nextTemplateId" class="meta-badge meta-badge-chain">
    Chains to: {{ getTemplateName(template.nextTemplateId) }}
  </span>
</div>
```

Add helper function:
```javascript
function getModelName(modelId) {
  const model = CLAUDE_MODELS.find(m => m.id === modelId);
  return model?.name || modelId;
}
```

#### 3.2 Update NewSessionView.vue - Add "Start From Template" Selector
**File**: `packages/web/src/views/NewSessionView.vue`

**Add NEW "Start From Template" dropdown at the TOP of the form** (before QuickResponsesPanel):

```vue
<!-- NEW: Start From Template selector - populates all fields -->
<div v-if="allTemplates.length > 0" class="form-group template-prefill-section">
  <label class="form-label" for="start-from-template">Start From Template (optional)</label>
  <select id="start-from-template" v-model="startFromTemplateId" class="form-input" @change="handleStartFromTemplateChange">
    <option :value="null">Select a template to pre-fill the form...</option>
    <optgroup v-if="projectTemplates.length" label="Project Templates">
      <option v-for="template in projectTemplates" :key="template.id" :value="template.id">
        {{ template.name }}
      </option>
    </optgroup>
    <optgroup v-if="globalTemplates.length" label="Global Templates">
      <option v-for="template in globalTemplates" :key="template.id" :value="template.id">
        {{ template.name }}
      </option>
    </optgroup>
  </select>
  <p class="form-help">
    Selecting a template will populate all form fields below. You can still edit before starting.
  </p>
</div>
```

**Add new ref and handler:**
```javascript
const startFromTemplateId = ref(null);

function handleStartFromTemplateChange() {
  if (!startFromTemplateId.value) return;

  const template = templatesStore.getTemplateById(startFromTemplateId.value);
  if (!template) return;

  // Populate prompt
  prompt.value = template.prompt;
  if (textareaRef.value) {
    textareaRef.value.value = template.prompt;
    textareaRef.value.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Populate other fields from template
  if (template.thinkingEnabled !== null && template.thinkingEnabled !== undefined) {
    thinkingEnabled.value = template.thinkingEnabled;
  }
  if (template.model) {
    model.value = template.model;
  }
  if (template.mode) {
    mode.value = template.mode;
  }
  if (template.gitBranch) {
    quickWorktreeBranch.value = template.gitBranch;
    editingBranch.value = true; // Mark as edited so it doesn't auto-regenerate
  }
  if (template.gitMode) {
    quickGitMode.value = template.gitMode;
  }

  // IMPORTANT: Also set the "Next Template" dropdown to the template's nextTemplateId
  if (template.nextTemplateId) {
    selectedTemplateId.value = template.nextTemplateId;
  }
}
```

**Rename existing "Session Template (optional)" to "Next Template (optional)":**

Change from:
```vue
<label class="form-label" for="template">Session Template (optional)</label>
```

To:
```vue
<label class="form-label" for="template">Next Template (optional)</label>
```

And update the help text from:
```vue
<p class="form-help">
  When selected, the template's settings are applied and a new session will automatically start when Claude finishes.
</p>
```

To:
```vue
<p class="form-help">
  After this session completes, the selected template will automatically start a new session.
</p>
```

**Add styling for the template prefill section:**
```css
.template-prefill-section {
  background-color: var(--color-bg-soft);
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px dashed var(--color-border);
  margin-bottom: 1rem;
}
```

---

## Testing Checklist

### Unit Tests
1. **SessionTemplateRepository tests**
   - Test create with model and mode
   - Test update of model and mode
   - Test getById includes model and mode

2. **Template API tests**
   - Test create template with model and mode
   - Test update template model and mode
   - Test validation of model and mode values

3. **templateTriggerService tests**
   - Test that model from template is used when creating new session
   - Test that mode from template is used when creating new session
   - Test fallback to parent session values when template doesn't specify

### E2E Tests
1. **Template management**
   - Create a template with specific model and mode
   - Edit template to change model and mode
   - Verify model and mode badges display on template cards

2. **New session with "Start From Template"**
   - Navigate to new session page
   - Select a template from "Start From Template" dropdown
   - Verify ALL form fields are populated (prompt, model, mode, thinking, git, next template)
   - Edit some fields manually
   - Click "Start Session" button
   - Verify session is created with correct settings

3. **Verify "Next Template" dropdown is independent**
   - Create a session WITHOUT using "Start From Template"
   - Manually select a "Next Template"
   - Verify the session is created with that next template set

4. **Template chaining**
   - Create a chain of templates (A -> B -> C)
   - Set different models/modes on each template
   - Use "Start From Template" to start with template A
   - Verify subsequent sessions use correct model and mode

---

## Migration Strategy

1. **For existing databases**: The migration will add columns with default values
   - Existing templates will get `model = 'claude-sonnet-4-20250514'` and `mode = 'yolo'`
   - These templates can then be edited to change the values

2. **For new installations**: The schema.sql will include the columns from the start

3. **Rollback**: If needed, can rollback by:
   - Dropping the columns from the schema
   - Reverting code changes
   - Note: Data in those columns would be lost

---

## Files to Modify Summary

### Backend
1. `packages/server/src/schema.sql` - Add model and mode columns
2. `packages/server/src/db/migrations/add_template_model_mode.sql` - New migration file
3. `packages/shared/src/contracts/templates.js` - Update Zod schemas
4. `packages/server/src/db/SessionTemplateRepository.js` - Update CRUD operations
5. `packages/server/src/services/templateTriggerService.js` - Use model/mode from template
6. `packages/server/src/api/templates.test.js` - Add tests for new fields
7. `packages/server/test/session-templates.test.js` - Add integration tests

### Frontend
1. `packages/web/src/components/TemplatesPanel.vue` - Add model and mode selectors
2. `packages/web/src/views/NewSessionView.vue` - Add "Start From Template" dropdown, rename existing dropdown
3. `packages/web/src/stores/templates.js` - No changes needed (passes through data)

### Tests
1. New E2E test for "Start From Template" feature
2. Update existing template-related tests to verify model and mode handling

---

## Open Questions / Decisions Needed

1. **Default values**: Should the defaults be user-configurable, or hard-coded?
   - Decision: Use hard-coded defaults matching current defaults (model: `claude-sonnet-4-20250514`, mode: `yolo`)

2. **Validation**: Should we validate that the model is a valid Claude model?
   - Decision: Backend validates against the Zod schema; frontend uses the CLAUDE_MODELS constant

3. **User experience**: When selecting a template from "Start From Template", should it replace ALL form fields, or only empty ones?
   - Decision: Replace all relevant fields to ensure template settings are fully applied

4. **Clear button**: Should there be a way to clear the "Start From Template" selection and reset the form?
   - Suggestion: Add a small "Clear" button next to the dropdown that resets all fields to defaults

---

## Estimated Effort

- Phase 1 (Database): 1-2 hours
- Phase 2 (Backend): 2-3 hours
- Phase 3 (Frontend): 3-4 hours (includes new UI element)
- Testing: 2-3 hours

**Total**: ~8-12 hours
