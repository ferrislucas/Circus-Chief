import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForStatus,
  waitForChildSession,
  getProjectSessions,
} from './helpers';
import {
  VCR_PROMPT,
  UNRECORDED_PROMPT,
  FORCE_PROACTIVE_RESCHEDULE_ON_ENTER,
  getBoard,
  getLaneByName,
  findLaneOfSession,
  findCardOfSession,
  setLaneOnEnter,
  addSessionToLaneViaUI,
  expectCardSettlesInLane,
  cardByIdInLane,
  moveCardViaUI,
  resumeScheduledSessionViaUI,
} from './kanbanLaneRunHelpers';

/**
 * E2E coverage for the durable, structured Kanban lane-run engine (FRD:
 * Kanban Lane-Run Structured Completion) — PR #1066 remediation, F1 (review
 * issue #1, BLOCKER).
 *
 * Before this file, `tests/e2e/kanban-completion-move.spec.ts` force-set every
 * configured lane back to `completionMode: 'legacy'`, so the structured path
 * — which is live by default for any lane with a completion target
 * (KanbanLaneRepository#update) — had zero E2E coverage, including no
 * end-to-end proof of the headline claim this PR exists to deliver: that the
 * reported incident (a session/service limit treated as lane completion) is
 * un-reproducible. This file drives the real UI/REST surface with the
 * deterministic VCR agent — no live model — through:
 *
 *  0. The reported-incident regression (root cause of this PR)
 *  1. AC-2  — a root with no descendants advances on its own success
 *  2. AC-7  — a transient limit + scheduled retry holds the card
 *  3. AC-8  — a permanent error leaves a visible, inspectable failure
 *  4. AC-5  — a scheduled descendant blocks until it succeeds, then rolls up
 *  5. AC-9  — a manual move supersedes the run; its later success is inert
 *  6. AC-14 — the target lane's on-enter automation starts exactly once
 */

test.describe('Kanban structured lane runs', () => {
  test.describe.configure({ timeout: 120000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Structured Lane Run Test', '/tmp/test-kanban-lane-run-structured');
    // Force board + default lanes (To Do, In Progress, Review, Done) to exist.
    await getBoard(project.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // ----------------------------------------------------------------
  // 0. Reported-incident regression (FRD §17 "Regression test for the
  //    reported incident"): move a workspace into Implementation, its
  //    on-entry worker hits what functions as a session/service limit with a
  //    scheduled continuation, the workspace must stay put — then, once the
  //    worker actually finishes successfully, the card advances exactly once.
  // ----------------------------------------------------------------
  test('reported incident: a scheduled continuation holds the card; only real success moves it', async ({
    page,
  }) => {
    const board = await getBoard(project.id);
    const inProgress = getLaneByName(board, 'In Progress');
    const done = getLaneByName(board, 'Done');

    await setLaneOnEnter(project.id, inProgress.id, {
      onEnterPrompt: VCR_PROMPT,
      completionTargetLaneId: done.id,
      ...FORCE_PROACTIVE_RESCHEDULE_ON_ENTER,
    });
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionMode).toBe('structured');

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: 'Reported Incident Workspace',
      startImmediately: false,
    });

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });

    // 1-2. Move the workspace into Implementation; the lane creates its
    // on-entry worker (the lane run's root session).
    await addSessionToLaneViaUI(page, 'In Progress', 'Reported Incident Workspace');
    const worker = await waitForChildSession(workspace.id, 15000);
    expect(worker.parentSessionId).toBe(workspace.id);

    // 3. Its automatic first turn hits the simulated limit — a scheduled
    // continuation is registered before the turn is considered "done".
    await waitForStatus(worker.id, 'scheduled', 20000);

    // 4. The Implementation lane run remains open; 5. the workspace stays put.
    let boardNow = await getBoard(project.id);
    expect(findLaneOfSession(boardNow, workspace.id)).toBe('In Progress');
    const runWhileScheduled = findCardOfSession(boardNow, workspace.id).activeLaneRun;
    expect(runWhileScheduled).toBeTruthy();
    expect(runWhileScheduled.status).toBe('open');
    expect(runWhileScheduled.rootSessionId).toBe(worker.id);

    // Give any incorrect early transition time to (wrongly) fire, then
    // reassert — this is the exact shape of the reported bug.
    await expect
      .poll(async () => findLaneOfSession(await getBoard(project.id), workspace.id), { timeout: 5000 })
      .toBe('In Progress');

    // 6. Resume and complete the root successfully (the real scheduler is
    // disabled under VCR_MODE — see resumeScheduledSessionViaUI).
    await resumeScheduledSessionViaUI(page, worker.id);

    // 7. The workspace then moves to Done exactly once.
    await expectCardSettlesInLane(project.id, workspace.id, 'Done');
    boardNow = await getBoard(project.id);
    const doneCard = findCardOfSession(boardNow, workspace.id);
    expect(doneCard.laneId).toBe(done.id);
    expect(doneCard.activeLaneRun).toBeNull();

    // Stays there — no further, duplicate movement.
    await new Promise((r) => setTimeout(r, 1500));
    expect(findLaneOfSession(await getBoard(project.id), workspace.id)).toBe('Done');
  });

  // ----------------------------------------------------------------
  // 1. AC-2: a root with no descendants advances on its own success.
  // ----------------------------------------------------------------
  test('a root session with no descendants advances the card on its own success', async ({ page }) => {
    const board = await getBoard(project.id);
    const inProgress = getLaneByName(board, 'In Progress');
    const done = getLaneByName(board, 'Done');

    await setLaneOnEnter(project.id, inProgress.id, {
      onEnterPrompt: VCR_PROMPT,
      completionTargetLaneId: done.id,
    });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: 'No Descendant Workspace',
      startImmediately: false,
    });

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await addSessionToLaneViaUI(page, 'In Progress', 'No Descendant Workspace');

    const worker = await waitForChildSession(workspace.id, 15000);
    await waitForStatus(worker.id, 'waiting', 20000);

    await expectCardSettlesInLane(project.id, workspace.id, 'Done');
    const card = findCardOfSession(await getBoard(project.id), workspace.id);
    expect(card.laneId).toBe(done.id);
    expect(card.activeLaneRun).toBeNull();

    // Done has no on-enter automation of its own — no extra child spawned.
    const allSessions = await getProjectSessions(project.id);
    const doneWorkers = allSessions.filter((s: any) => s.parentSessionId === workspace.id);
    expect(doneWorkers).toHaveLength(1); // just the "In Progress" worker
  });

  // ----------------------------------------------------------------
  // 2. AC-7: a transient limit + scheduled retry holds the card (the
  //    "half" of the reported-incident regression focused purely on the
  //    holding behavior, independent of eventual resolution).
  // ----------------------------------------------------------------
  test('a scheduled retry after a simulated transient limit holds the card open', async ({ page }) => {
    const board = await getBoard(project.id);
    const inProgress = getLaneByName(board, 'In Progress');
    const done = getLaneByName(board, 'Done');

    await setLaneOnEnter(project.id, inProgress.id, {
      onEnterPrompt: VCR_PROMPT,
      completionTargetLaneId: done.id,
      ...FORCE_PROACTIVE_RESCHEDULE_ON_ENTER,
    });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: 'Rate Limit Workspace',
      startImmediately: false,
    });

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await addSessionToLaneViaUI(page, 'In Progress', 'Rate Limit Workspace');

    const worker = await waitForChildSession(workspace.id, 15000);
    await waitForStatus(worker.id, 'scheduled', 20000);

    const card = findCardOfSession(await getBoard(project.id), workspace.id);
    expect(card.laneId).toBe(inProgress.id);
    expect(card.activeLaneRun.status).toBe('open');
    // Visibility (FR-12): the run reports it is waiting on scheduled work.
    expect(card.activeLaneRun.blockingReason).toBe('Waiting for scheduled work');
    expect(card.activeLaneRun.scheduledCount).toBeGreaterThan(0);
  });

  // ----------------------------------------------------------------
  // 3. AC-8: a permanent error leaves a visible, inspectable failure; the
  //    card never advances to the completion target.
  // ----------------------------------------------------------------
  test('a permanent failure leaves the card in place with an inspectable failed run', async ({ page }) => {
    const board = await getBoard(project.id);
    const inProgress = getLaneByName(board, 'In Progress');
    const done = getLaneByName(board, 'Done');

    // No cassette is committed for UNRECORDED_PROMPT, so under the default
    // VCR_MODE=replay the VCR adapter throws deterministically instead of
    // ever contacting a live model (see VCRAgentAdapter.execute()). That
    // error does not match any transient reschedule-trigger pattern, so it
    // is a reliable, offline permanent-failure fixture.
    await setLaneOnEnter(project.id, inProgress.id, {
      onEnterPrompt: UNRECORDED_PROMPT,
      completionTargetLaneId: done.id,
    });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: 'Permanent Failure Workspace',
      startImmediately: false,
    });

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await addSessionToLaneViaUI(page, 'In Progress', 'Permanent Failure Workspace');

    const worker = await waitForChildSession(workspace.id, 15000);
    await waitForStatus(worker.id, 'error', 20000);

    const card = findCardOfSession(await getBoard(project.id), workspace.id);
    expect(card.laneId).toBe(inProgress.id); // never advanced
    expect(card.activeLaneRun).toBeTruthy();
    expect(card.activeLaneRun.status).toBe('failed');
    expect(card.activeLaneRun.failedSessionId).toBe(worker.id);
    expect(card.activeLaneRun.failureReason).toBeTruthy();

    // Stays failed and in place — not silently cleared or retried.
    await new Promise((r) => setTimeout(r, 1000));
    const boardAfter = await getBoard(project.id);
    expect(findLaneOfSession(boardAfter, workspace.id)).toBe('In Progress');
    expect(findCardOfSession(boardAfter, workspace.id).activeLaneRun.status).toBe('failed');
  });

  // ----------------------------------------------------------------
  // 4. AC-5: a scheduled descendant blocks the card until it succeeds, then
  //    success rolls up to the root.
  // ----------------------------------------------------------------
  test('a scheduled descendant holds the card until it succeeds, then rolls up', async ({ page }) => {
    const board = await getBoard(project.id);
    const inProgress = getLaneByName(board, 'In Progress');
    const done = getLaneByName(board, 'Done');

    await setLaneOnEnter(project.id, inProgress.id, {
      onEnterPrompt: VCR_PROMPT,
      completionTargetLaneId: done.id,
      ...FORCE_PROACTIVE_RESCHEDULE_ON_ENTER,
    });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: 'Scheduled Descendant Workspace',
      startImmediately: false,
    });

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await addSessionToLaneViaUI(page, 'In Progress', 'Scheduled Descendant Workspace');

    // Hold the worker's OWN turn open (deterministically) so we can attach a
    // scheduled child to it before its own work ever closes — this avoids
    // racing the automatic on-enter turn against REST child creation.
    const worker = await waitForChildSession(workspace.id, 15000);
    await waitForStatus(worker.id, 'scheduled', 20000);

    // Attach a scheduled descendant to the worker (agent-facing REST
    // contract: parentSessionId). It becomes a blocking obligation
    // immediately on creation (FR-3.3/FR-4.4), well before its own due time.
    const descendant = await seedSession(project.id, {
      prompt: 'Deferred follow-up work',
      name: 'Scheduled Grandchild',
      parentSessionId: worker.id,
      startImmediately: false,
      scheduledAt: Date.now() + 3600000,
    });
    expect(descendant.parentSessionId).toBe(worker.id);
    expect(descendant.status).toBe('scheduled');

    // Now let the worker's OWN work finish for real (clear its self-imposed
    // reschedule and run a normal, final turn).
    await resumeScheduledSessionViaUI(page, worker.id);

    // The worker's own work succeeded, but the scheduled descendant is still
    // open — the subtree (and therefore the card) must hold.
    let boardNow = await getBoard(project.id);
    expect(findLaneOfSession(boardNow, workspace.id)).toBe('In Progress');
    expect(findCardOfSession(boardNow, workspace.id).activeLaneRun.status).toBe('open');

    // Give it a moment (no incorrect move should ever fire).
    await new Promise((r) => setTimeout(r, 1000));
    expect(findLaneOfSession(await getBoard(project.id), workspace.id)).toBe('In Progress');

    // Resolve the descendant for real — success rolls up to the root.
    await resumeScheduledSessionViaUI(page, descendant.id);

    await expectCardSettlesInLane(project.id, workspace.id, 'Done');
    boardNow = await getBoard(project.id);
    expect(findCardOfSession(boardNow, workspace.id).activeLaneRun).toBeNull();
  });

  // ----------------------------------------------------------------
  // 5. AC-9: a manual move supersedes the open run; a later success from
  //    that superseded run never moves the card again.
  // ----------------------------------------------------------------
  test('a manual move supersedes the run; its later success is inert', async ({ page }) => {
    const board = await getBoard(project.id);
    const inProgress = getLaneByName(board, 'In Progress');
    const done = getLaneByName(board, 'Done');

    await setLaneOnEnter(project.id, inProgress.id, {
      onEnterPrompt: VCR_PROMPT,
      completionTargetLaneId: done.id,
      ...FORCE_PROACTIVE_RESCHEDULE_ON_ENTER,
    });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: 'Manual Move Workspace',
      startImmediately: false,
    });

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await addSessionToLaneViaUI(page, 'In Progress', 'Manual Move Workspace');

    const worker = await waitForChildSession(workspace.id, 15000);
    await waitForStatus(worker.id, 'scheduled', 20000);
    expect(findCardOfSession(await getBoard(project.id), workspace.id).activeLaneRun.status).toBe('open');

    // A user manually moves the card to a lane with no automation/target.
    await moveCardViaUI(page, cardByIdInLane(page, 'In Progress', workspace.id), 'Review');
    await expect(cardByIdInLane(page, 'Review', workspace.id)).toBeVisible();

    let boardNow = await getBoard(project.id);
    expect(findLaneOfSession(boardNow, workspace.id)).toBe('Review');
    // Review has no target/automation, so no new run opens either.
    expect(findCardOfSession(boardNow, workspace.id).activeLaneRun).toBeNull();

    // The OLD run's root session (still pointed at the superseded run) is
    // now resumed and finishes successfully for real.
    await resumeScheduledSessionViaUI(page, worker.id);
    await waitForStatus(worker.id, 'waiting', 30000);

    // Its late success must never move the card, nor start Done's automation.
    await new Promise((r) => setTimeout(r, 1500));
    boardNow = await getBoard(project.id);
    expect(findLaneOfSession(boardNow, workspace.id)).toBe('Review');
    expect(findCardOfSession(boardNow, workspace.id).activeLaneRun).toBeNull();

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await expect(cardByIdInLane(page, 'Review', workspace.id)).toBeVisible();
    await expect(cardByIdInLane(page, 'Done', workspace.id)).toHaveCount(0);
  });

  // ----------------------------------------------------------------
  // 6. AC-14: the target lane's on-enter automation starts exactly once.
  // ----------------------------------------------------------------
  test('the target lane on-enter automation fires exactly once on transition', async ({ page }) => {
    const board = await getBoard(project.id);
    const inProgress = getLaneByName(board, 'In Progress');
    const done = getLaneByName(board, 'Done');

    await setLaneOnEnter(project.id, inProgress.id, {
      onEnterPrompt: VCR_PROMPT,
      completionTargetLaneId: done.id,
    });
    // The completion TARGET also has its own on-enter automation.
    await setLaneOnEnter(project.id, done.id, { onEnterPrompt: VCR_PROMPT });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: 'Target Automation Workspace',
      startImmediately: false,
    });

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await addSessionToLaneViaUI(page, 'In Progress', 'Target Automation Workspace');

    // Identify the source-lane worker by its on-enter naming convention
    // rather than trusting "the first child found" — under parallel-worker
    // load the whole source-turn -> completion -> target-automation chain
    // can finish before this first poll even runs, so a plain
    // waitForChildSession() could non-deterministically return either
    // worker.
    await waitForChildSession(workspace.id, 15000);
    let sourceWorker: any;
    await expect
      .poll(
        async () => {
          const all = await getProjectSessions(project.id);
          sourceWorker = all.find(
            (s: any) => s.parentSessionId === workspace.id && s.name.includes('lane: In Progress')
          );
          return Boolean(sourceWorker);
        },
        { timeout: 15000 }
      )
      .toBe(true);
    await waitForStatus(sourceWorker.id, 'waiting', 20000);

    await expectCardSettlesInLane(project.id, workspace.id, 'Done');

    // Done's on-enter automation spawns a NEW worker, a direct child of the
    // workspace root (triggerStructuredTransitionAutomation), distinct from
    // the source lane's worker. Poll specifically for it (rather than "any
    // 2nd child") — the target-lane trigger is a separate async step that
    // runs just after the card's lane_id commits, so there is a brief window
    // right after expectCardSettlesInLane where it has not landed yet.
    await expect
      .poll(
        async () => {
          const all = await getProjectSessions(project.id);
          return all.filter(
            (s: any) => s.parentSessionId === workspace.id && s.name.includes('lane: Done')
          ).length;
        },
        { timeout: 15000 }
      )
      .toBe(1);

    const allSessionsNow = await getProjectSessions(project.id);
    const targetWorker = allSessionsNow.find(
      (s: any) => s.parentSessionId === workspace.id && s.name.includes('lane: Done')
    );
    expect(targetWorker).toBeTruthy();
    expect(targetWorker.id).not.toBe(sourceWorker.id);

    // Give a duplicate trigger time to (wrongly) fire, then assert there is
    // still exactly one Done-lane worker.
    await new Promise((r) => setTimeout(r, 2000));
    const doneWorkers = (await getProjectSessions(project.id)).filter(
      (s: any) => s.parentSessionId === workspace.id && s.name.includes('lane: Done')
    );
    expect(doneWorkers).toHaveLength(1);
  });
});
