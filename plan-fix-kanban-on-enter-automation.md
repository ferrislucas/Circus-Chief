# Fix: Kanban lane on-enter automation never triggers

## Bug

When a session is moved into a lane that has an `onEnterPrompt` or `onEnterTemplateId` configured — via drag-and-drop or the Move Card modal — the automation never fires. No child session is created.

## Root Cause

The `PATCH /api/projects/:projectId/kanban/cards/:cardId/move` route in `packages/server/src/api/kanban.js` (line 254) bypasses the service layer entirely. It calls the repository directly:

```js
// Current broken code (kanban.js lines 276-289)
const movedCard = kanbanCards.moveToLane(cardId, targetLaneId, sortOrder);
broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, { ... });
// Note: runOnEnterTemplate handling is done in kanbanService, not here in basic route
res.json(movedCard);
```

Meanwhile, the automation logic lives in `kanbanService.moveCard()` (`packages/server/src/services/kanbanService.js` line 116), which is **never called** from the API route. The frontend correctly sends `runOnEnterTemplate: true`, the Zod schema correctly parses it, but the route handler ignores it.

## Plan

### Step 1: Wire the API route to the service layer

**File:** `packages/server/src/api/kanban.js`

- Add import: `import { moveCard as moveCardService } from '../services/kanbanService.js'`
- Make the route handler `async`
- Replace the direct `kanbanCards.moveToLane()` + manual `broadcastToProject()` with a call to `moveCardService(cardId, targetLaneId, { sortOrder, runOnEnterTemplate })`
- Remove the manual broadcast (the service already broadcasts `KANBAN_CARD_MOVED`)
- Wrap in try/catch for error handling
- Keep the existing card/lane existence checks for proper 404 responses

### Step 2: Run existing tests

- Run `yarn workspace @claudetools/server test` to verify nothing breaks
- Run `yarn workspace @claudetools/web test` for frontend tests

### Step 3: Verify the Zod contract (already confirmed)

The `MoveKanbanCardRequest` schema in `packages/shared/src/contracts/kanban.js` already includes `runOnEnterTemplate: z.boolean().default(true)` — no changes needed here.

## What the fixed route will look like

```js
router.patch('/cards/:cardId/move', async (req, res) => {
  const { cardId } = req.params;

  const result = MoveKanbanCardRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const card = kanbanCards.getByIdWithLane(cardId);
  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }

  const { targetLaneId, sortOrder, runOnEnterTemplate } = result.data;

  const targetLane = kanbanLanes.getById(targetLaneId);
  if (!targetLane) {
    return res.status(404).json({ error: 'Target lane not found' });
  }

  try {
    const movedCard = await moveCardService(cardId, targetLaneId, {
      sortOrder,
      runOnEnterTemplate,
    });
    res.json(movedCard);
  } catch (error) {
    console.error('Failed to move kanban card:', error);
    res.status(500).json({ error: error.message });
  }
});
```

## Risk Assessment

- **Double broadcast**: Eliminated by removing the manual `broadcastToProject` from the route — the service handles it.
- **Scope**: Single-file change (`kanban.js`). The service layer and frontend are already correct.
- **Backward compatibility**: No API contract changes. The request/response shapes are identical.
