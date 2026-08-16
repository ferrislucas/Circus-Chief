import { expect, Page, Locator } from '@playwright/test';
import {
  API_URL,
  BASE_URL,
  getSession,
  navigateAndWait,
  openSessionOverlay,
  updatePendingPrompt,
  updateSessionScheduling,
  waitForStatus,
} from './helpers';

/**
 * Shared helpers for Kanban lane-run / completion-move E2E specs.
 *
 * Used by both `kanban-completion-move.spec.ts` (legacy per-turn completion
 * signal) and `kanban-lane-run-structured.spec.ts` (durable structured lane
 * runs). Extracted here (PR #1066 remediation, F1) so the two suites share
 * one implementation of board/lane/card plumbing instead of drifting apart.
 */

// ============================================================
// VCR fixtures
// ============================================================

/**
 * The lifecycle tests start sessions through the chat input. To keep them
 * deterministic and runnable in the default `VCR_MODE=replay`, they reuse the
 * prompt of an already-committed cassette pair
 * (runSession-ec0df80145f024e5.json / continueSession-ec0df80145f024e5.json).
 * The cassette key is callType + a hash of this exact prompt, so the text
 * MUST match byte-for-byte.
 *
 * If you ever change this prompt, re-record with:
 *   VCR_MODE=record ./scripts/pw.sh test tests/e2e/kanban-completion-move.spec.ts tests/e2e/kanban-lane-run-structured.spec.ts
 * and commit the new cassettes under tests/e2e/cassettes/.
 */
export const VCR_PROMPT = 'Claude E2E regression: reply with exactly "Claude E2E response."';
export const VCR_MODEL = 'claude-haiku-4-5-20251001';

// A deterministic graceful provider-limit result. Its cassette is deliberately
// a runSession fixture: the human Resume action below uses VCR_PROMPT for the
// subsequent successful continuation.
export const LIMIT_PROMPT = 'Claude E2E regression: provider usage limit.';

/**
 * A prompt with NO committed cassette. Under the default `VCR_MODE=replay`,
 * the VCR adapter throws deterministically (`VCR replay: no cassette found`)
 * instead of ever contacting a live model — see VCRAgentAdapter.execute().
 * That thrown error does not match any transient reschedule-trigger pattern
 * (sessionErrors.js matchesTokenLimitError/matchesServiceError), so it is a
 * reliable, offline way to drive a session through a genuine PERMANENT
 * failure end-to-end (AC-8), without needing a live model or a special mock.
 */
export const UNRECORDED_PROMPT = 'Claude E2E regression: UNRECORDED CASSETTE — deterministic permanent failure.';

/** Wait until a VCR-gated tool call has parked a live turn. */
export async function waitForPendingPrompt(sessionId: string, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const session = await getSession(sessionId);
    if (session?.pendingAgentInput) return session;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Session ${sessionId} never surfaced a pending prompt within ${timeout}ms`);
}

// ============================================================
// Board / lane / card helpers
// ============================================================

export async function getBoard(projectId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/kanban`);
  if (!response.ok) throw new Error(`Failed to fetch board: ${response.status}`);
  return response.json();
}

export function getLaneByName(board: any, name: string) {
  return board.lanes.find((lane: any) => lane.name === name);
}

/** Return the name of the lane that currently holds the given session's card, or null. */
export function findLaneOfSession(board: any, sessionId: string): string | null {
  for (const lane of board.lanes) {
    for (const card of lane.cards || []) {
      if ((card.sessions || []).some((s: any) => s.id === sessionId)) {
        return lane.name;
      }
    }
  }
  return null;
}

/** Return the card object (including `activeLaneRun`) that holds the given session, or null. */
export function findCardOfSession(board: any, sessionId: string): any | null {
  for (const lane of board.lanes) {
    for (const card of lane.cards || []) {
      if ((card.sessions || []).some((s: any) => s.id === sessionId)) {
        return card;
      }
    }
  }
  return null;
}

/** Configure a destination lane's on-enter automation via the REST API (test setup). */
export async function setLaneOnEnter(projectId: string, laneId: string, settings: object) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/kanban/lanes/${laneId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error(`Failed to set lane on-enter automation: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

/** Count child sessions of a parent (used for negative assertions). */
export async function countChildSessions(parentSessionId: string, projectId: string): Promise<number> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions`);
  if (!response.ok) throw new Error(`Failed to fetch project sessions: ${response.status}`);
  const all = await response.json();
  return all.filter((s: any) => s.parentSessionId === parentSessionId).length;
}

/** Locate a kanban lane by its exact title (avoids matching card text). */
export function laneByTitle(page: Page, title: string): Locator {
  return page.locator('.kanban-lane').filter({
    has: page.locator('.lane-title', { hasText: new RegExp(`^${title}$`) }),
  });
}

/** Locate a card (by session name) inside a specific lane. */
export function cardInLane(page: Page, laneTitle: string, sessionName: string): Locator {
  return laneByTitle(page, laneTitle).locator('.kanban-card').filter({ hasText: sessionName });
}

/**
 * Locate a card by SESSION ID inside a specific lane, via the card's
 * `/sessions/{id}` link. Use this when the card's title may change out from
 * under the test — e.g. after a turn completes, summary generation can rename
 * the session, so matching on the seeded name becomes unreliable.
 */
export function cardByIdInLane(page: Page, laneTitle: string, sessionId: string): Locator {
  return laneByTitle(page, laneTitle)
    .locator('.kanban-card')
    .filter({ has: page.locator(`a[href$="/sessions/${sessionId}"]`) });
}

export async function openLaneSettings(page: Page, laneTitle: string) {
  await laneByTitle(page, laneTitle).locator('.lane-settings-btn').click();
  await expect(page.locator('.modal-content')).toBeVisible();
  await expect(page.locator('#completion-target-lane-select')).toBeVisible();
}

export async function saveLaneSettings(page: Page) {
  await page.click('.modal-footer .btn-primary');
  await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });
}

/** A lightweight on-enter prompt for tests that only need to satisfy the
 * "a completion target requires on-entry automation" contract and never
 * actually execute the automation (e.g. pure target-persistence UI tests).
 * Tests that DO expect the automation to run should pass their own
 * VCR-cassette-backed prompt to `configureAutomatedLane` instead. */
export const LANE_AUTOMATION_PROMPT = 'Lane automation trigger (E2E fixture, not expected to execute)';

/**
 * Open a source lane's settings, configure its on-entry automation (prompt or
 * template) AND its completion target in the SAME save, and save.
 *
 * Kanban lane hard-cutover contract (KanbanLaneRepository#assertConfiguration):
 * a lane cannot carry a completion target unless it has on-entry automation.
 * This helper is the only supported way E2E tests configure a completion
 * target — it requires a prompt or a template label so a caller cannot
 * accidentally produce the invalid target-only combination the UI now
 * rejects (see `LaneSettingsModal.vue`'s `isValid`/`targetRequiresAutomation`).
 *
 * Replaces the removed `configureCompletionTarget` helper (hard-cutover
 * remediation, Phase 1): that helper only ever set the target and relied on
 * the server auto-deriving a (now-removed) `completionMode`, which is no
 * longer a valid save.
 */
export async function configureAutomatedLane(
  page: Page,
  _projectId: string,
  sourceLane: string,
  options: { prompt?: string; templateLabel?: string; targetLabel?: string }
) {
  const { prompt, templateLabel, targetLabel } = options;
  if (!prompt && !templateLabel) {
    throw new Error('configureAutomatedLane requires a prompt or a templateLabel to configure on-entry automation');
  }
  await openLaneSettings(page, sourceLane);
  if (templateLabel) {
    await page.locator('input[type="radio"][value="template"]').check();
    await page.selectOption('#template-select', { label: templateLabel });
  } else {
    await page.locator('input[type="radio"][value="prompt"]').check();
    await page.locator('#custom-prompt').fill(prompt as string);
  }
  if (targetLabel !== undefined) {
    await page.selectOption('#completion-target-lane-select', { label: targetLabel });
  }
  await saveLaneSettings(page);
}

/** Add a (draft) session to a lane via the lane's "Add Session" modal. */
export async function addSessionToLaneViaUI(page: Page, laneTitle: string, sessionName: string) {
  await laneByTitle(page, laneTitle).locator('.add-session-btn').click();
  await expect(page.locator('.modal-content')).toBeVisible();
  await page.waitForSelector('.session-item', { timeout: 10000 });
  await page.locator('.session-item').filter({ hasText: sessionName }).first().click();
  await page.click('.modal-footer .btn-primary');
  await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });
}

/**
 * Ensure the chat overlay is showing the requested session before interacting.
 *
 * When a workspace has a running descendant, the overlay auto-resolves to that
 * running child (see useSessionTree.resolveOverlayTarget). In that state the
 * root's composer is not shown — the child renders its "Stop" running state
 * instead of `.btn-send-full`. So when the overlay landed on a different
 * session, switch to the target via the session picker dropdown.
 */
export async function selectOverlaySession(page: Page, sessionId: string) {
  const picker = page.locator('[data-testid="overlay-picker-trigger"]');
  if (!(await picker.isVisible().catch(() => false))) return;

  const activeTarget = page.locator(
    `[data-testid="session-chat-picker"] .picker-item--active[data-session-id="${sessionId}"]`
  );
  await picker.click();
  await page.locator('[data-testid="session-chat-picker"]').waitFor({ state: 'visible' });
  if ((await activeTarget.count()) === 0) {
    await page
      .locator(`[data-testid="session-chat-picker"] .picker-item[data-session-id="${sessionId}"]`)
      .click();
  } else {
    await picker.click();
  }
}

/**
 * Drive a real agent turn through the UI: open the session, type a prompt
 * into the visible chat input, send, and wait for the turn to settle to the
 * given terminal status (default 'waiting', VCR replay). This is what
 * triggers the production turn-completion / lane-run hooks.
 */
export async function runSessionTurnViaUI(
  page: Page,
  sessionId: string,
  options: { prompt?: string; expectStatus?: string; timeout?: number } = {}
) {
  const { prompt = VCR_PROMPT, expectStatus = 'waiting', timeout = 60000 } = options;
  await navigateAndWait(page, `${BASE_URL}/sessions/${sessionId}/summary`);
  await openSessionOverlay(page);
  await selectOverlaySession(page, sessionId);
  await expect(page.locator('.btn-send-full').first()).toBeVisible({ timeout: 15000 });
  const textarea = page.locator('.input-form textarea');
  await textarea.fill(prompt);
  await page.locator('.btn-send-full').first().click();
  if (expectStatus) {
    await waitForStatus(sessionId, expectStatus, timeout);
  }
}

/**
 * Drive a FOLLOW-UP agent turn (turn 2+) through the UI.
 *
 * Unlike `runSessionTurnViaUI`, this must NOT wait for status 'waiting' up
 * front: between turns the session is already 'waiting', so that check would
 * return immediately without ever observing the new turn.
 */
export async function runFollowUpTurnViaUI(page: Page, sessionId: string, prompt: string = VCR_PROMPT) {
  await navigateAndWait(page, `${BASE_URL}/sessions/${sessionId}/summary`);
  await openSessionOverlay(page);
  // When the workspace has a competing descendant (e.g. a scheduled child),
  // the overlay may auto-resolve there instead of the requested session —
  // make sure we are composing against the requested session before sending.
  await selectOverlaySession(page, sessionId);
  await expect(page.locator('.btn-send-full').first()).toBeVisible({ timeout: 15000 });
  const textarea = page.locator('.input-form textarea');
  await textarea.fill(prompt);
  await page.locator('.btn-send-full').first().click();
}

/** Poll the board until the given session's card lands in the expected lane. */
export async function expectCardSettlesInLane(
  projectId: string,
  sessionId: string,
  laneName: string,
  timeout = 15000
) {
  await expect
    .poll(async () => findLaneOfSession(await getBoard(projectId), sessionId), { timeout })
    .toBe(laneName);
}

/**
 * Move a card between lanes through the kanban move modal (same flow as
 * kanban-move-card.spec.ts): hover the card, click its move button, select
 * the target lane radio, and confirm.
 */
/**
 * Lane on-enter settings that force the very first turn of a spawned on-enter
 * worker to self-reschedule deterministically (via the real, production
 * proactive-token-reschedule path — `_checkProactiveReschedule` /
 * `schedulerService.rescheduleSession`, see sessionErrors.js) instead of
 * closing its own work. Any real VCR-replayed reply consumes at least a
 * handful of tokens, so a threshold of 1 always fires. This is the
 * deterministic, offline stand-in this suite uses for "the session hit a
 * session/service limit and a continuation got scheduled" (AC-6/AC-7,
 * FR-4) — the resulting session/run state (own_work_state stays 'open',
 * execution_state becomes 'scheduled') is identical to what an actual
 * thrown rate-limit error with auto-reschedule would produce; only the
 * trigger reason differs.
 */
export const FORCE_PROACTIVE_RESCHEDULE_ON_ENTER = {
  onEnterAutoRescheduleEnabled: true,
  onEnterRescheduleOnTokenLimit: true,
  onEnterRescheduleOnServiceError: true,
  onEnterRescheduleAtTokenCount: 1,
};

/**
 * "Resume" a session that is sitting in `scheduled` status, the way the real
 * (production) scheduler would once its due time passed. The scheduler is
 * intentionally disabled for the whole E2E run under `VCR_MODE` (see
 * scripts/pw.sh and schedulerService#startIfEnabled) so tests stay
 * deterministic and never depend on wall-clock polling. Existing precedent
 * for manually performing the scheduler's hand-off in this situation is
 * `scheduling-reschedule.spec.ts`'s "scheduler starts session when
 * scheduledAt time is reached" test.
 *
 * Clears only the token-threshold that would otherwise immediately re-trigger
 * a proactive reschedule, then invokes the production scheduler's explicit
 * run-now hand-off. A chat message is intentionally not used here: messages
 * sent by a person are interactive and, unless resuming a paused provider
 * limit, must not declare the worker's own lane work complete.
 */
export async function resumeScheduledSessionViaUI(
  _page: Page,
  sessionId: string,
  options: { prompt?: string; rescheduleAtTokenCount?: number | null } = {}
) {
  const { prompt = VCR_PROMPT, rescheduleAtTokenCount = null } = options;
  // `pendingPrompt` is not one of the general PATCH /api/sessions/:id fields
  // (see FIELD_DEFINITIONS in sessions-patch.js) — it must go through the
  // dedicated endpoint, or the session's existing pendingPrompt is silently
  // left untouched.
  await updatePendingPrompt(sessionId, prompt);
  await updateSessionScheduling(sessionId, { rescheduleAtTokenCount });
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/run-scheduled-now`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to run scheduled session ${sessionId}: ${response.status} ${await response.text()}`);
  }
  await waitForStatus(sessionId, 'waiting', 60000);
}

/**
 * Ask a superseded worker to schedule more work. The scheduling mutation is
 * itself ownership-fenced, so callers assert the explicit 409 response
 * instead of first restoring stale executable state.
 */
export async function attemptResumeStaleWorker(sessionId: string) {
  return fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scheduledAt: Date.now(),
      rescheduleAtTokenCount: null,
    }),
  });
}

export async function moveCardViaUI(page: Page, card: Locator, toLane: string) {
  await card.hover();
  await card.locator('.card-move-btn').click();
  await expect(page.locator('.modal-title')).toHaveText('Move to Lane');
  await page
    .locator('.lane-row')
    .filter({ hasText: toLane })
    .locator('input[type="radio"]')
    .check();
  await page.click('.modal-footer .btn-primary');
  await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });
}
