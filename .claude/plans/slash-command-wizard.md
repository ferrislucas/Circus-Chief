# Slash Command Wizard Implementation Plan

## Overview

Replace the autocomplete-style slash commands from PR #142 with a wizard-based modal UI. Users click a slash icon button to open a modal that guides them through selecting and configuring commands before execution.

---

## Key Differences from PR #142

| Aspect | PR #142 (Autocomplete) | Our Approach (Wizard Modal) |
|--------|------------------------|----------------------------|
| Trigger | Type `/` in input | Click slash icon button |
| UI | Dropdown autocomplete | Full modal wizard |
| Selection | Type to filter, arrow keys | Click/tap command cards |
| Arguments | Type after command name | Form inputs (select, text) |
| Execution | Manual send | Auto-execute on wizard completion |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Backend                                  │
├─────────────────────────────────────────────────────────────────┤
│  slashCommandService.js                                         │
│  ├── Discover commands from 3 sources                           │
│  ├── Parse YAML frontmatter (description, arguments)            │
│  └── Return command metadata for wizard UI                      │
│                                                                 │
│  commands.js (API)                                              │
│  ├── GET /api/commands?directory=...     (list all)             │
│  ├── GET /api/commands/:name?directory=... (get one)            │
│  └── POST /api/commands/:name/execute    (execute command)      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
├─────────────────────────────────────────────────────────────────┤
│  SlashCommandButton.vue                                         │
│  └── Icon button that opens the wizard modal                    │
│                                                                 │
│  SlashCommandWizard.vue                                         │
│  ├── Step 1: Command selection (card grid)                      │
│  ├── Step 2: Argument configuration (dynamic form)              │
│  └── Step 3: Confirmation & execution                           │
│                                                                 │
│  useSlashCommands.js (composable)                               │
│  ├── Fetch available commands                                   │
│  ├── Manage wizard state                                        │
│  └── Execute selected command                                   │
│                                                                 │
│  stores/slashCommands.js (Pinia store)                          │
│  └── Cache commands, track loading state                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Backend Service & API

### 1.1 Create `slashCommandService.js`

**Location:** `packages/server/src/services/slashCommandService.js`

```javascript
// Command sources (in priority order)
const BUILTIN_COMMANDS = [
  // Removed: model, mode, stop, clear, cost, status, config (have UI already)
  { name: 'help', description: 'Display help information', arguments: [] },
  { name: 'compact', description: 'Compress conversation context', arguments: [] },
];
```

**Enhanced YAML Frontmatter Schema:**
```yaml
---
description: "Deploy to an environment"
arguments:
  - name: environment
    type: select           # select | text | multiline
    label: "Target Environment"
    options:               # for select type
      - { value: "staging", label: "Staging" }
      - { value: "production", label: "Production" }
    required: true
  - name: message
    type: text
    label: "Deploy Message"
    placeholder: "Optional deploy note..."
    required: false
---

Deploy command body content that gets sent to Claude...
```

**Functions:**
- `getCommands(workingDirectory)` - List all available commands
- `getCommand(workingDirectory, name)` - Get single command with full details
- `parseCommandFile(content)` - Parse YAML frontmatter
- `executeCommand(sessionId, commandName, args)` - Execute the command

### 1.2 Create `commands.js` API Route

**Location:** `packages/server/src/api/commands.js`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/commands` | GET | List commands (`?directory=...`) |
| `/api/commands/:name` | GET | Get command details (`?directory=...`) |
| `/api/commands/:name/execute` | POST | Execute command with args |

### 1.3 Register Route

**File:** `packages/server/src/api/index.js`
- Add `import commandsRouter from './commands.js'`
- Add `router.use('/commands', commandsRouter)`

---

## Phase 2: Frontend Store & API Client

### 2.1 Extend ApiClient

**File:** `packages/web/src/api/ApiClient.js`

```javascript
// Add methods:
async getCommands(directory) { ... }
async getCommand(directory, name) { ... }
async executeCommand(sessionId, commandName, args) { ... }
```

### 2.2 Create Pinia Store

**File:** `packages/web/src/stores/slashCommands.js`

```javascript
export const useSlashCommandsStore = defineStore('slashCommands', {
  state: () => ({
    commands: [],
    loading: false,
    error: null,
    lastFetchedDirectory: null,
  }),

  actions: {
    async fetchCommands(directory) { ... },
    async executeCommand(sessionId, name, args) { ... },
  },

  getters: {
    builtinCommands: (state) => state.commands.filter(c => c.source === 'builtin'),
    projectCommands: (state) => state.commands.filter(c => c.source === 'project'),
    userCommands: (state) => state.commands.filter(c => c.source === 'user'),
  },
});
```

---

## Phase 3: Wizard UI Components

### 3.1 SlashCommandButton.vue

**Location:** `packages/web/src/components/SlashCommandButton.vue`

Simple icon button that opens the wizard modal:
```vue
<template>
  <button
    type="button"
    class="slash-command-btn"
    @click="openWizard"
    title="Slash Commands"
  >
    <span class="slash-icon">/</span>
  </button>
</template>
```

**Placement:** Next to the file attachment button in `ConversationTab.vue`

### 3.2 SlashCommandWizard.vue (Main Modal)

**Location:** `packages/web/src/components/SlashCommandWizard.vue`

**Wizard Steps:**

```
┌────────────────────────────────────────────────────────────────┐
│  Step 1: Select Command                                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   /help     │  │   /clear    │  │  /compact   │            │
│  │  Display    │  │   Clear     │  │  Compress   │            │
│  │  help info  │  │  history    │  │  context    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                │
│  ── Project Commands ──────────────────────────────            │
│  ┌─────────────┐  ┌─────────────┐                              │
│  │  /deploy    │  │  /test      │                              │
│  │  Deploy to  │  │  Run test   │                              │
│  │  environment│  │  suite      │                              │
│  └─────────────┘  └─────────────┘                              │
│                                                                │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  Step 2: Configure Arguments (for /deploy)                     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Target Environment *                                          │
│  ┌──────────────────────────────────────────┐                  │
│  │  Staging                              ▼  │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                │
│  Deploy Message                                                │
│  ┌──────────────────────────────────────────┐                  │
│  │  Optional deploy note...                 │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                │
│                              [Back]  [Execute Command]         │
└────────────────────────────────────────────────────────────────┘
```

**Component Structure:**
```vue
<template>
  <Teleport to="body">
    <div v-if="isOpen" class="wizard-overlay">
      <div class="wizard-modal">
        <header class="wizard-header">
          <h2>{{ stepTitle }}</h2>
          <button @click="close">×</button>
        </header>

        <div class="wizard-content">
          <!-- Step 1: Command Selection -->
          <CommandGrid
            v-if="step === 1"
            :commands="commands"
            @select="selectCommand"
          />

          <!-- Step 2: Arguments Form -->
          <ArgumentsForm
            v-else-if="step === 2"
            :command="selectedCommand"
            v-model="args"
            @back="step = 1"
            @submit="executeCommand"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

### 3.3 CommandGrid.vue (Sub-component)

**Location:** `packages/web/src/components/slash-commands/CommandGrid.vue`

Displays commands in categorized sections (Builtin, Project, User) with card-style buttons.

### 3.4 ArgumentsForm.vue (Sub-component)

**Location:** `packages/web/src/components/slash-commands/ArgumentsForm.vue`

Dynamic form that renders inputs based on command's `arguments` schema:
- `type: select` → `<select>` dropdown
- `type: text` → `<input type="text">`
- `type: multiline` → `<textarea>`

---

## Phase 4: Integration

### 4.1 Update ConversationTab.vue

Add the slash command button to the input controls:

```vue
<div class="session-options">
  <FileAttachment ... />
  <SlashCommandButton @open="showSlashWizard = true" />
  <div class="thinking-toggle">...</div>
  <div class="mode-switcher">...</div>
</div>

<SlashCommandWizard
  v-model:isOpen="showSlashWizard"
  :session-id="sessionId"
  :working-directory="workingDirectory"
  @executed="handleCommandExecuted"
/>
```

### 4.2 Command Execution Flow

When user completes the wizard:
1. Wizard calls `api.executeCommand(sessionId, commandName, args)`
2. Backend constructs the full command string (e.g., `/deploy staging "Ready for QA"`)
3. Backend sends it as a message to the session (or handles built-in commands specially)
4. Modal closes, UI shows the command was sent

---

## Phase 5: Testing

### 5.1 Backend Tests

**File:** `packages/server/src/services/slashCommandService.test.js`
- Test frontmatter parsing with arguments schema
- Test command discovery from all sources
- Test priority/deduplication

**File:** `packages/server/src/api/commands.test.js`
- Test API endpoints
- Test execute endpoint

### 5.2 Frontend Tests

**File:** `packages/web/src/stores/slashCommands.test.js`
- Test store actions and getters

**File:** `packages/web/src/components/SlashCommandWizard.test.js`
- Test wizard flow
- Test argument form rendering

### 5.3 E2E Tests

**File:** `tests/e2e/slashCommands.spec.ts`
- Test opening wizard
- Test selecting command
- Test filling arguments
- Test execution

---

## Implementation Order

| Order | Task | Estimated Effort |
|-------|------|------------------|
| 1 | Backend: `slashCommandService.js` | Medium |
| 2 | Backend: `commands.js` API routes | Small |
| 3 | Backend: Unit tests | Medium |
| 4 | Frontend: ApiClient methods | Small |
| 5 | Frontend: Pinia store | Small |
| 6 | Frontend: `SlashCommandButton.vue` | Small |
| 7 | Frontend: `SlashCommandWizard.vue` | Large |
| 8 | Frontend: `CommandGrid.vue` | Medium |
| 9 | Frontend: `ArgumentsForm.vue` | Medium |
| 10 | Frontend: Integration in ConversationTab | Small |
| 11 | Frontend: Component tests | Medium |
| 12 | E2E tests | Medium |

---

## File Checklist

### New Files
- [ ] `packages/server/src/services/slashCommandService.js`
- [ ] `packages/server/src/services/slashCommandService.test.js`
- [ ] `packages/server/src/api/commands.js`
- [ ] `packages/server/src/api/commands.test.js`
- [ ] `packages/web/src/stores/slashCommands.js`
- [ ] `packages/web/src/stores/slashCommands.test.js`
- [ ] `packages/web/src/components/SlashCommandButton.vue`
- [ ] `packages/web/src/components/SlashCommandWizard.vue`
- [ ] `packages/web/src/components/slash-commands/CommandGrid.vue`
- [ ] `packages/web/src/components/slash-commands/ArgumentsForm.vue`
- [ ] `tests/e2e/slashCommands.spec.ts`

### Modified Files
- [ ] `packages/server/src/api/index.js` - Add commands route
- [ ] `packages/web/src/api/ApiClient.js` - Add command methods
- [ ] `packages/web/src/components/ConversationTab.vue` - Add button & wizard
- [ ] `packages/web/src/views/NewSessionView.vue` - Add button & wizard

---

## Design Decisions

1. **Built-in commands**: Only `/help` and `/compact` (all others have existing UI: model, mode, stop, clear, cost, status, config)

2. **Command execution**: All commands (built-in and custom) sent as messages through the SDK - Claude Code interprets them natively

3. **Custom command arguments**: Use our extended frontmatter schema with typed arguments (select, text, multiline)

4. **Search/filter**: YES - Include search box in wizard for users with many custom commands

5. **Keyboard accessibility**: Deferred - Not in initial implementation

6. **Wizard locations**: Available in both `ConversationTab.vue` AND `NewSessionView.vue`

7. **NewSessionView behavior**:
   - Only show **custom commands** (hide built-in `/help` and `/compact` - they don't make sense for new sessions)
   - After wizard completion, **insert command text into prompt field** (Option A)
   - User can review/edit, then click "Start Session"

8. **ConversationTab behavior**:
   - Show **all commands** (built-in + custom)
   - After wizard completion, **send immediately** as a message
   - Output appears in conversation as Claude's response
