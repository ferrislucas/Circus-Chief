# E2E Test Plan: Session Created from Template Appears in Kanban Lane

## Bug Being Surfaced

When a session is created from a template that has a `targetLaneId` configured, the kanban card is correctly placed in the target lane, but the session's own `targetLaneId` field is never set. This breaks downstream behavior like `handleTurnCompletion()` which checks `session.targetLaneId` to know where to move the card.

**Root cause:** `applyTemplateOverrides()` in `packages/server/src/api/projects.js` copies `thinkingEnabled`, `gitBranch`, `gitMode`, and `effortLevel` from the template — but never copies `targetLaneId`.

---

## Files to Modify

### 1. `tests/e2e/helpers.ts` — Small type additions

- Add `targetLaneId?: string | null` to `seedProjectTemplate` data parameter
- Add exported `getKanbanBoard(projectId)` helper (currently only defined locally in `kanban-on-enter-automation.spec.ts`)

### 2. `tests/e2e/kanban-template-target-lane.spec.ts` — New test file

---

## Test Design

### Setup (API — in `beforeEach`)

1. `cleanupCreatedResources()`
2. `seedProject('Kanban Template Lane Test', '/tmp/test-kanban-tpl')`
3. `getKanbanBoard(project.id)` — triggers auto-creation of default lanes (To Do, In Progress, Done, Blocked)
4. Pick the **"In Progress"** lane from `board.lanes`
5. `seedProjectTemplate(project.id, { name: 'Lane Template', prompt: 'Test prompt', targetLaneId: lane.id })` — create template pointing to that lane
6. Use `updateTemplate(template.id, { nextTemplateId: template.id })` so that when "Start From Template" is selected in the UI, `handleStartFromTemplateChange()` auto-sets the "Next Template" dropdown (which is what gets sent as `templateId` to the server)

### Test Steps (Browser UI)

| Step | Action | Selector |
|------|--------|----------|
| 1 | Navigate to new session form | `/projects/:id/sessions/new` |
| 2 | Wait for template dropdown | `#start-from-template` |
| 3 | Select template from "Start From Template" | `page.selectOption('#start-from-template', template.id)` |
| 4 | Verify prompt was auto-filled | `textarea#prompt` should contain template prompt |
| 5 | Ensure "Start Immediately" is unchecked | Uncheck if needed (we don't want to launch Claude) |
| 6 | Click "Create Draft" | `button:has-text("Create Draft")` |
| 7 | Wait for redirect to session detail | URL matches `/sessions/:id` |
| 8 | Extract session ID from URL | `page.url().match(...)` |
| 9 | Navigate to kanban board | `/projects/:id/kanban`, wait for `.kanban-board` |
| 10 | Find "In Progress" lane | `.kanban-lane` filtered by text "In Progress" |
| 11 | **Assert card exists in lane** | `expect(lane.locator('.kanban-card')).toHaveCount(1)` |
| 12 | **Assert session targetLaneId is set** | `getSession(id)` → `expect(session.targetLaneId).toBe(lane.id)` |

### Expected Results

| Assertion | Expected | Actual (with bug) |
|-----------|----------|-------------------|
| Card appears in "In Progress" lane (step 11) | **PASS** | PASS — `addSessionToTemplateTargetLane()` works |
| `session.targetLaneId === lane.id` (step 12) | **FAIL** | FAIL — `applyTemplateOverrides()` never sets it |

### Teardown (in `afterEach`)

- `cleanupCreatedResources()` — deletes sessions, projects (lanes cascade-delete with project)

---

## Key Detail: How `templateId` Flows Through the UI

```
"Start From Template" dropdown (startFromTemplateId)
  → handleStartFromTemplateChange()
    → populates prompt, mode, model, thinking, git settings
    → if template.nextTemplateId exists → sets "Next Template" dropdown (selectedTemplateId)

Form submit → sends { templateId: selectedTemplateId }
  → server: prepareSessionConfig() sets config.templateId
  → server: applyTemplateOverrides() — MISSING targetLaneId copy
  → server: addSessionToTemplateTargetLane(session.id, config.templateId) — card created OK
```

This is why we set `nextTemplateId` on the template to point to itself — it ensures `selectedTemplateId` gets populated in the UI, which causes `templateId` to be sent to the server.
