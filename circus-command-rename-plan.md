# Plan: Rename "Command Button" → "Circus Command" (User-Visible Text Only)

## Goal

Rename all user-visible "Command Button" text to "Circus Command" across the UI, system prompt, documentation, and tests. Internal code identifiers (API URLs, DB table names, JS variables, file names) stay as `commandButton`/`command-buttons`.

## Background

The system prompt heading is currently `## Commands API`. The UI labels say "Command Buttons". Users and agents need a consistent, discoverable name. The agent already half-understands "commands" from the heading — we need the UI and prompt to converge on "Circus Commands".

## Files to Modify

### Phase 1: Source Files (6 files)

#### 1. `packages/server/src/services/commandButtonPrompts.js`
- Rename heading from `## Commands API` → `## Circus Commands`
- Add a discoverability note after the heading, before the API docs:

```
## Circus Commands

This project has Circus Commands configured - reusable shell commands you can execute. Use the Bash tool to run these curl commands.

> When the user asks to "run a command", "what commands are available", "list circus commands", or similar, use the Commands API below to discover and execute them.
```

#### 2. `packages/web/src/components/CommandsTab.vue`
- Line 5: `Command Buttons` → `Circus Commands`
- Line 20: `Loading command buttons...` → `Loading Circus Commands...`
- Line 43: `No command buttons configured for this project.` → `No Circus Commands configured for this project.`
- Line 48: `Configure Command Buttons` → `Configure Circus Commands`

#### 3. `packages/web/src/components/CommandButtonsPanel.vue`
- Line 5: `Command Buttons` → `Circus Commands`
- Line 10: `+ New Command Button` → `+ New Circus Command`
- Line 20: `Loading command buttons...` → `Loading Circus Commands...`
- Line 36: `No command buttons configured yet.` → `No Circus Commands configured yet.`
- Line 105: `Delete Command Button` → `Delete Circus Command`
- Line 108: `Are you sure you want to delete the command button` → `Are you sure you want to delete the Circus Command`

#### 4. `packages/web/src/views/CommandButtonDetailView.vue`
- Line 23: `'Edit Command Button'` → `'Edit Circus Command'`, `'New Command Button'` → `'New Circus Command'`
- Line 147: `Delete Command Button` → `Delete Circus Command`
- Line 267: `'Command button updated'` → `'Circus Command updated'`
- Line 270: `'Command button created'` → `'Circus Command created'`
- Line 297: `'Command button deleted'` → `'Circus Command deleted'`

#### 5. `README.md`
- Line 21: `Command buttons with live status` → `Circus Commands with live status`
- Line 28: `Command buttons` → `Circus Commands`

#### 6. `docs/agent-system-prompt.md`
- Line 18: `Commands API` → `Circus Commands` (in the prompt assembly table)
- Line 72: `### Commands API (conditional)` → `### Circus Commands (conditional)`
- Line 74: Update the builder description to reflect the new heading
- Lines 78-82: No change needed (these are API URL paths, which stay as `/command-buttons`)

### Phase 2: Test Files (4 files)

#### 7. `packages/web/src/components/CommandsTab.test.js`
- No assertions currently check for "Command Button" text strings directly. The tests stub `CommandButtonItem` and don't assert on header/empty-state text. **No changes needed** but consider adding a rendering test that verifies the new "Circus Commands" heading appears.

#### 8. `packages/web/src/components/CommandButtonsPanel.test.js`
- Line 60: `'Loading command buttons'` → `'Loading Circus Commands'`
- Line 103: `'No command buttons configured yet'` → `'No Circus Commands configured yet'`
- Line 212: `'Delete Command Button'` → `'Delete Circus Command'`

#### 9. `packages/web/src/views/CommandButtonDetailView.test.js`
- Line 98: `'New Command Button'` → `'New Circus Command'`

#### 10. `packages/server/src/services/sessionPrompts.test.js`
- Line 569: `'## Commands API'` → `'## Circus Commands'`
- Line 581: `'## Commands API'` → `'## Circus Commands'`
- Line 593: `'## Commands API'` → `'## Circus Commands'`
- Add a new test: verify the discoverability note text is present in the prompt output

### Phase 3: E2E Tests (1 file)

#### 11. `tests/e2e/commandButtons.spec.ts`
- Line 92: `page.getByText('No command buttons configured')` → `page.getByText('No Circus Commands configured')`
- Line 10 (optional): `test.describe('Command Buttons', ...)` → `test.describe('Circus Commands', ...)` — cosmetic, for consistency
- Line 18 (optional): `seedProject('Command Buttons', ...)` → `seedProject('Circus Commands', ...)` — cosmetic

## What Does NOT Change

- **API URL paths** stay as `/command-buttons` (e.g. `/api/sessions/{id}/command-buttons`)
- **Database table names** stay as-is
- **JavaScript variable/function names** stay as `commandButton`, `buildCommandButtonApiInstructions`, etc.
- **Component file names** stay as `CommandButtonDetailView.vue`, `CommandsTab.vue`, etc.
- **Store names** stay as `useCommandButtonsStore`
- **CSS class names** stay as `.command-buttons-panel`, etc.
- **HTML comments** in Vue templates (e.g. `<!-- Command button status indicators -->`) — leave as-is
- **JSDoc/code comments** — leave as-is for Phase 1

## Verification

1. `yarn workspace @circuschief/server test src/services/sessionPrompts.test.js` — prompt tests pass with updated heading
2. `yarn workspace @circuschief/web test src/components/CommandButtonsPanel.test.js` — panel tests pass
3. `yarn workspace @circuschief/web test src/views/CommandButtonDetailView.test.js` — detail view tests pass
4. `yarn workspace @circuschief/web test src/components/CommandsTab.test.js` — tab tests pass
5. `yarn test` — full monorepo unit test suite passes
6. `./scripts/pw.sh test tests/e2e/commandButtons.spec.ts` — E2E tests pass
7. `yarn lint` — no lint errors
8. Manual: open a project with commands and verify the Commands tab, management panel, and detail view all show "Circus Commands"

## Future Work (Phase 4 — Not This PR)

Internal rename of variable names, file names, DB tables, API URLs (~143 files). Cosmetic only, no user impact. Can be done incrementally.
