import { describe, it, expect, vi } from 'vitest';
import { projects, sessions, sessionSummaries, modelProviders, modelTiers } from '../database.js';
import { buildTierRef } from '@circuschief/shared';

// Work Item 2: summaryCoverageRepair.js's omission-correction retry must
// inherit tier failover the same way summaryGenerate.js does — both call
// through the single callSummaryModel entry point (already fully covered,
// including the tier-failover loop itself, in summaryModelClient.test.js).
// This test proves the *wiring*: handleWorkflowCoverageRepair passes the
// tier-bound globalSettings through to callSummaryModel unchanged as
// `summarySettings`, so any behavior implemented inside callSummaryModel —
// including tier failover — is automatically reachable from this caller
// without callSummaryModel's internals needing to be re-tested here.
const mocks = vi.hoisted(() => ({
  callSummaryModel: vi.fn(),
}));

vi.mock('./summaryModelClient.js', () => ({
  callSummaryModel: mocks.callSummaryModel,
}));

import { handleWorkflowCoverageRepair } from './summaryCoverageRepair.js';

describe('summaryCoverageRepair inherits tier failover wiring (Work Item 2)', () => {
  it('passes the tier-bound globalSettings through to callSummaryModel unchanged for the omission-correction retry', async () => {
    const project = projects.create('Coverage Repair Project', '/tmp/coverage-repair-test');
    const parent = sessions.create(project.id, 'Parent Session', 'Parent prompt', 'standard');
    const child = sessions.create(project.id, 'Distinctive Child Task', 'Child prompt', {
      mode: 'standard',
      parentSessionId: parent.id,
    });

    sessionSummaries.create(child.id, {
      shortSummary: 'Child summary',
      fullSummary: 'Child full summary',
      outcome: 'completed',
    });

    const tierProvider = modelProviders.create({ name: 'Coverage Repair Tier Provider', kind: 'anthropic' });
    modelProviders.addModel(tierProvider.id, { modelId: 'coverage-repair-model', displayName: 'Model' });
    const tier = modelTiers.create({
      name: 'Coverage Repair Tier',
      members: [{ providerId: tierProvider.id, modelId: 'coverage-repair-model', position: 0 }],
    });
    const globalSettings = { summaryModel: buildTierRef(tier.id), summaryProviderId: null };

    mocks.callSummaryModel.mockResolvedValue(
      JSON.stringify({
        short_summary: 'Updated summary mentioning Distinctive Child Task',
        full_summary: 'Full summary mentioning Distinctive Child Task completed',
      })
    );

    const summaryDataInput = {
      shortSummary: 'Root summary',
      fullSummary: 'Root full summary with no mention of the child work',
      outcome: 'completed',
    };

    await handleWorkflowCoverageRepair(summaryDataInput, parent.id, {
      recentMessages: [],
      session: parent,
      globalSettings,
    });

    expect(mocks.callSummaryModel).toHaveBeenCalledTimes(1);
    expect(mocks.callSummaryModel.mock.calls[0][3]).toMatchObject({
      summarySettings: globalSettings,
      logMeta: expect.objectContaining({ sessionId: parent.id, callType: 'workflowCoverageRetry' }),
    });
  });

  it('does not call callSummaryModel when there are no descendants (no coverage repair needed)', async () => {
    mocks.callSummaryModel.mockClear();
    const project = projects.create('No Descendants Project', '/tmp/no-descendants-test');
    const parent = sessions.create(project.id, 'Solo Session', 'Prompt', 'standard');

    const result = await handleWorkflowCoverageRepair(
      { shortSummary: 'S', fullSummary: 'F', outcome: 'completed' },
      parent.id,
      { recentMessages: [], session: parent, globalSettings: {} }
    );

    expect(mocks.callSummaryModel).not.toHaveBeenCalled();
    expect(result).toEqual({ shortSummary: 'S', fullSummary: 'F', outcome: 'completed' });
  });
});
