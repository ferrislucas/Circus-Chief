# Functional Requirements Document: Conditional Waiting Indicator

**Feature:** Project list waiting-status emphasis  
**Status:** Proposed  
**Date:** 2026-09-13

## 1. Objective

Make the `waiting` text in each Project List activity summary visually prominent only when that project has one or more sessions genuinely awaiting user input. When no session is awaiting input, the `waiting` count, dot, and label must use the same muted gray treatment as the surrounding summary text.

## 2. Background

Every project card displays an activity summary with running, waiting, and workspace counts. The waiting item is currently styled in orange regardless of its count, causing `0 waiting` to imply attention is needed.

The existing `waitingSessionCount` API field is the authoritative signal. It counts sessions with `pendingAgentInput = true`; it intentionally does **not** count every session whose lifecycle status is `waiting` (which may simply mean idle and ready for a later follow-up).

## 3. Scope

### In scope

- Project List view activity summary on every project card.
- Conditional color treatment of the waiting count, its dot, and its `waiting` label.
- Automated UI coverage for both zero and non-zero waiting counts.

### Out of scope

- Changing session state, `pendingAgentInput`, API aggregation, count values, filters, sorting, navigation, or card layout.
- Changing the visual treatment of running or workspace indicators.
- Changing waiting-status treatments in session lists, Kanban, or detail views.

## 4. Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-1 | Each project card must continue to show its waiting summary item, including the numeric count and label. |
| FR-2 | If `project.waitingSessionCount` is `0`, the waiting item (text and dot) must render in the existing muted/gray summary color. |
| FR-3 | If `project.waitingSessionCount` is greater than `0`, the waiting item (text and dot) must render in the existing warning/orange color. |
| FR-4 | The visual state must update whenever refreshed project data changes `waitingSessionCount`, without requiring navigation or a page reload. |
| FR-5 | A nonzero count must mean at least one session is actually awaiting user input, as supplied by the existing `waitingSessionCount` contract; the UI must not infer this from a session lifecycle status string. |
| FR-6 | Existing summary content, count formatting, accessibility label, and click behavior must remain unchanged. |

## 5. User Experience

| Project condition | Example displayed text | Required appearance |
| --- | --- | --- |
| No sessions awaiting input | `0 waiting` | Muted gray, matching the normal summary text. |
| One or more sessions awaiting input | `1 waiting`, `2 waiting` | Existing warning/orange emphasis. |

The status dot uses `currentColor`, so applying the conditional color to the waiting summary item must update its dot and label together.

## 6. Acceptance Criteria

1. A project whose `waitingSessionCount` is `0` renders a waiting summary element without the warning/emphasis class and appears muted gray.
2. A project whose `waitingSessionCount` is greater than `0` renders the warning/emphasis class and appears orange.
3. In a list containing both conditions, only cards with a positive waiting count receive orange waiting text and dots.
4. The running indicator retains its current conditional behavior, and workspace text retains its current muted behavior.
5. Existing tests that assert the summary displays running, waiting, and workspace counts continue to pass.

## 7. Implementation Notes

- Target view: `packages/web/src/views/ProjectListView.vue`.
- Replace the unconditional waiting warning styling with a base muted waiting style plus a conditional modifier when `waitingSessionCount > 0`, mirroring the existing running-count pattern.
- Add or extend `ProjectListView` unit tests to assert the modifier is present only for a positive waiting count.
- No server, shared-contract, or database change is required: the existing project response already exposes `waitingSessionCount` with the intended semantics.

## 8. Verification

Run the focused Project List view test suite. Verify at least these data states:

1. `waitingSessionCount: 0`
2. `waitingSessionCount: 1`
3. A mixed list with one zero-count project and one positive-count project

## 9. Risks and Dependencies

- **Dependency:** The project-list API must continue to populate `waitingSessionCount` accurately from `pendingAgentInput`.
- **Risk:** Styling based on `session.status === 'waiting'` would incorrectly flag ordinary idle/draft sessions. This feature must rely only on the aggregate count supplied to the card.
