import { describe, it, expect, beforeEach } from 'vitest';
import {
  modelProviders,
  modelTiers,
  settings,
  projects,
  projectDefaults,
  sessionTemplates,
  sessions,
  kanbanBoards,
  kanbanLanes,
} from '../database.js';
import { buildTierRef } from '@circuschief/shared';
import { validateModelAndProvider } from '../api/model-validation.js';
import { resolveProviderFromModel } from './sessionProvider.js';

// Regression coverage for the review finding: deleting a provider (or removing
// its last executable model / renaming a model id) can empty a tier, and every
// persisted consumer of that tier must be degraded atomically with the loss —
// not left dangling on an unresolvable `tier::<id>` ref that breaks session
// creation. Mirrors the guarantees of `deleteTierAndDegradeReferences`.
describe('tier consumer repair on provider/model loss (tierDeletionService)', () => {
  let providerA;
  let providerB;

  beforeEach(() => {
    providerA = modelProviders.create({ name: 'Loss Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'loss-model-a', displayName: 'A' });
    providerB = modelProviders.create({ name: 'Loss Provider B', kind: 'anthropic' });
    modelProviders.addModel(providerB.id, { modelId: 'loss-model-b', displayName: 'B' });
  });

  /**
   * Persist one consumer of every tier-reference surface against `tierRef`.
   * @returns {{ project, template, lane, session }} Created fixture rows.
   */
  function createConsumers(tierRef) {
    const project = projects.create('Tier loss consumers', '/tmp/tier-loss-consumers');
    const template = sessionTemplates.create({
      projectId: project.id, name: 'Loss template', prompt: 'Run', model: tierRef,
    });
    projectDefaults.upsert(project.id, { model: tierRef, providerId: null });
    const board = kanbanBoards.create(project.id);
    const lane = kanbanLanes.create(board.id, { name: 'Loss lane', onEnterModel: tierRef });
    const session = sessions.create(project.id, 'Loss session', 'Later', {
      status: 'scheduled', model: tierRef,
    });
    sessions.update(session.id, { pendingModel: tierRef });
    settings.setSummarySettings({
      disableSessionSummaries: false,
      sessionTitlePrompt: '',
      summaryModel: tierRef,
      summaryProviderId: null,
    });
    return { project, template, lane, session };
  }

  function expectConsumersDegraded({ template, lane, session }, expected = {}) {
    expect(sessionTemplates.getById(template.id).model).toBeNull();
    expect(kanbanLanes.getById(lane.id).onEnterModel).toBeNull();
    expect(projectDefaults.getByProjectId(expected.projectId ?? session.projectId))
      .toMatchObject({ model: null, providerId: null });
    expect(sessions.getById(session.id)).toMatchObject({
      model: null, pendingModel: null, providerId: null,
      resolvedModel: null, resolvedProviderId: null,
    });
    expect(settings.getSummarySettings()).toMatchObject({ summaryModel: '', summaryProviderId: null });
  }

  describe('provider deletion', () => {
    it('degrades every persisted consumer when the deleted provider empties a single-member tier', () => {
      const tier = modelTiers.create({
        name: 'Sole Member Tier',
        members: [{ providerId: providerA.id, modelId: 'loss-model-a', position: 0 }],
      });
      const consumers = createConsumers(buildTierRef(tier.id));

      modelProviders.delete(providerA.id);

      expectConsumersDegraded(consumers);
      // PRD §7 S7 / §8 E2: the emptied tier itself is kept for repopulation —
      // it merely stops appearing in selectors.
      expect(modelTiers.getByIdWithMembers(tier.id)).not.toBeNull();
      expect(modelTiers.getByIdWithMembers(tier.id).members).toEqual([]);
    });

    it('leaves consumers untouched when the tier keeps executable members on other providers', () => {
      const tier = modelTiers.create({
        name: 'Survivor Tier',
        members: [
          { providerId: providerA.id, modelId: 'loss-model-a', position: 0 },
          { providerId: providerB.id, modelId: 'loss-model-b', position: 1 },
        ],
      });
      const tierRef = buildTierRef(tier.id);
      const consumers = createConsumers(tierRef);

      modelProviders.delete(providerA.id);

      const projectDefaultsRow = projectDefaults.getByProjectId(consumers.session.projectId);
      expect(projectDefaultsRow).toMatchObject({ model: tierRef });
      expect(sessionTemplates.getById(consumers.template.id).model).toBe(tierRef);
      expect(kanbanLanes.getById(consumers.lane.id).onEnterModel).toBe(tierRef);
      expect(sessions.getById(consumers.session.id)).toMatchObject({ model: tierRef, pendingModel: tierRef });
      expect(settings.getSummarySettings()).toMatchObject({ summaryModel: tierRef });
    });

    it('clears a session snapshot pinned to the deleted provider while honoring snapshots on live providers', () => {
      const tier = modelTiers.create({
        name: 'Snapshot Tier',
        members: [{ providerId: providerA.id, modelId: 'loss-model-a', position: 0 }],
      });
      const tierRef = buildTierRef(tier.id);
      const project = projects.create('Tier loss snapshots', '/tmp/tier-loss-snapshots');
      const deadSnapshotSession = sessions.create(project.id, 'Dead snapshot', 'Later', {
        status: 'waiting', model: tierRef,
      });
      sessions.update(deadSnapshotSession.id, {
        resolvedModel: 'loss-model-a',
        resolvedProviderId: providerA.id,
      });

      modelProviders.delete(providerA.id);

      // The snapshot names a provider that no longer exists — pinning to it
      // would leave the session unusable, so it is cleared to the default.
      expect(sessions.getById(deadSnapshotSession.id)).toMatchObject({
        model: null, providerId: null, resolvedModel: null, resolvedProviderId: null,
      });
    });

    it('deletes a provider referenced by no tier without disturbing other tiers', () => {
      const tier = modelTiers.create({
        name: 'Unrelated Tier',
        members: [{ providerId: providerB.id, modelId: 'loss-model-b', position: 0 }],
      });
      const consumers = createConsumers(buildTierRef(tier.id));

      expect(() => modelProviders.delete(providerA.id)).not.toThrow();

      expect(projectDefaults.getByProjectId(consumers.session.projectId).model).toBe(buildTierRef(tier.id));
    });
  });

  describe('model removal (soft tombstone)', () => {
    it('retains a historical session snapshot for a soft-removed tier member', () => {
      const tier = modelTiers.create({
        name: 'Tombstoned Snapshot Tier',
        members: [{ providerId: providerA.id, modelId: 'loss-model-a', position: 0 }],
      });
      const project = projects.create('Tombstoned snapshot session', '/tmp/tombstoned-snapshot-session');
      const session = sessions.create(project.id, 'Tombstoned snapshot', 'Later', {
        status: 'waiting', model: buildTierRef(tier.id),
      });
      sessions.update(session.id, {
        resolvedModel: 'loss-model-a',
        resolvedProviderId: providerA.id,
      });
      const modelRow = modelProviders
        .getById(providerA.id).models
        .find((entry) => entry.modelId === 'loss-model-a');

      modelProviders.removeModel(modelRow.id);

      expect(sessions.getById(session.id)).toMatchObject({
        model: 'loss-model-a', providerId: providerA.id,
        resolvedModel: null, resolvedProviderId: null,
      });
    });

    it('degrades consumers when removing the last executable model of a tier', () => {
      const tier = modelTiers.create({
        name: 'Tombstoned Member Tier',
        members: [{ providerId: providerA.id, modelId: 'loss-model-a', position: 0 }],
      });
      const consumers = createConsumers(buildTierRef(tier.id));
      const modelRow = modelProviders
        .getById(providerA.id).models
        .find((entry) => entry.modelId === 'loss-model-a');

      modelProviders.removeModel(modelRow.id);

      expectConsumersDegraded(consumers);
      // Soft removal retains member rows so the tier is repopulatable.
      expect(modelTiers.getByIdWithMembers(tier.id).members).toHaveLength(1);
    });

    it('keeps the tier bound when another member remains executable', () => {
      const tier = modelTiers.create({
        name: 'Partially Removed Tier',
        members: [
          { providerId: providerA.id, modelId: 'loss-model-a', position: 0 },
          { providerId: providerB.id, modelId: 'loss-model-b', position: 1 },
        ],
      });
      const tierRef = buildTierRef(tier.id);
      const consumers = createConsumers(tierRef);
      const modelRow = modelProviders
        .getById(providerA.id).models
        .find((entry) => entry.modelId === 'loss-model-a');

      modelProviders.removeModel(modelRow.id);

      expect(projectDefaults.getByProjectId(consumers.session.projectId).model).toBe(tierRef);
      expect(sessions.getById(consumers.session.id)).toMatchObject({ model: tierRef });
    });
  });

  describe('model id rename (updateModel)', () => {
    it('clears a stale session snapshot when a provider renames its only tier member', () => {
      const tier = modelTiers.create({
        name: 'Renamed Snapshot Tier',
        members: [{ providerId: providerA.id, modelId: 'loss-model-a', position: 0 }],
      });
      const tierRef = buildTierRef(tier.id);
      const project = projects.create('Renamed snapshot session', '/tmp/renamed-snapshot-session');
      const session = sessions.create(project.id, 'Renamed snapshot', 'Later', {
        status: 'waiting', model: tierRef,
      });
      sessions.update(session.id, {
        resolvedModel: 'loss-model-a',
        resolvedProviderId: providerA.id,
      });
      const modelRow = modelProviders
        .getById(providerA.id).models
        .find((entry) => entry.modelId === 'loss-model-a');

      modelProviders.updateModel(modelRow.id, { modelId: 'loss-model-a-renamed' });

      const repaired = sessions.getById(session.id);
      // A live provider alone does not make a renamed/nonexistent snapshot
      // addressable. The repair must clear it to normal default resolution.
      expect(repaired).toMatchObject({
        model: null, providerId: null, resolvedModel: null, resolvedProviderId: null,
      });
      expect(validateModelAndProvider(repaired.model, repaired.providerId)).not.toHaveProperty('error');
      expect(resolveProviderFromModel(repaired.model, repaired.providerId)).toBeNull();
    });

    it('degrades consumers when renaming the only executable member model id', () => {
      const tier = modelTiers.create({
        name: 'Renamed Member Tier',
        members: [{ providerId: providerA.id, modelId: 'loss-model-a', position: 0 }],
      });
      const consumers = createConsumers(buildTierRef(tier.id));
      const modelRow = modelProviders
        .getById(providerA.id).models
        .find((entry) => entry.modelId === 'loss-model-a');

      modelProviders.updateModel(modelRow.id, { modelId: 'loss-model-a-renamed' });

      expectConsumersDegraded(consumers);
    });

    it('does not touch consumers when the update does not rename the model id', () => {
      const tier = modelTiers.create({
        name: 'Redisplayed Member Tier',
        members: [{ providerId: providerA.id, modelId: 'loss-model-a', position: 0 }],
      });
      const tierRef = buildTierRef(tier.id);
      const consumers = createConsumers(tierRef);
      const modelRow = modelProviders
        .getById(providerA.id).models
        .find((entry) => entry.modelId === 'loss-model-a');

      modelProviders.updateModel(modelRow.id, { displayName: 'Renamed display only' });

      expect(projectDefaults.getByProjectId(consumers.session.projectId).model).toBe(tierRef);
    });
  });

  describe('stale references (self-healing)', () => {
    it('clears consumers still pointing at a tier that no longer exists', () => {
      const consumers = createConsumers(buildTierRef('no-such-tier'));
      // The dangling ref predates this run (e.g. written by an older version);
      // any provider loss sweeps it.
      const disposable = modelProviders.create({ name: 'Loss Disposable Provider', kind: 'anthropic' });
      modelProviders.addModel(disposable.id, { modelId: 'loss-model-disposable', displayName: 'D' });

      modelProviders.delete(disposable.id);

      expectConsumersDegraded(consumers);
    });
  });
});

// ── Structured degradation change sets (review remediation §2) ──────────────
//
// The degradation service must return a structured change set — affected
// session ids (with their projects), lane-affected projects, and whether the
// global summary settings were rewritten — from the same transaction that
// performs the repair, so the API layer can publish canonical post-degradation
// state to connected websocket clients AFTER commit.

describe('structured degradation change sets (client sync)', () => {
  let providerA;

  beforeEach(() => {
    providerA = modelProviders.create({ name: 'ChangeSet Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'changeset-model-a', displayName: 'A' });
  });

  it('deleteTierAndDegradeReferences returns the affected sessions, lane projects, and summary change', async () => {
    const { deleteTierAndDegradeReferences } = await import('./tierDeletionService.js');
    const created = modelTiers.create({
      name: 'ChangeSet Tier',
      members: [{ providerId: providerA.id, modelId: 'changeset-model-a', position: 0 }],
    });
    const tierRef = buildTierRef(created.id);
    const project = projects.create('ChangeSet Project', '/tmp/changeset-project');
    const board = kanbanBoards.create(project.id);
    kanbanLanes.create(board.id, { name: 'ChangeSet lane', onEnterModel: tierRef });
    const session = sessions.create(project.id, 'ChangeSet session', 'Later', {
      status: 'waiting', model: tierRef,
    });
    settings.setSummarySettings({
      disableSessionSummaries: false,
      sessionTitlePrompt: '',
      summaryModel: tierRef,
      summaryProviderId: null,
    });

    const result = deleteTierAndDegradeReferences(created.id);

    expect(result).not.toBeNull();
    expect(result.degradation).toMatchObject({
      degradedFrom: tierRef,
      affectedSessions: [{ id: session.id, projectId: project.id }],
      laneProjectIds: [project.id],
      summarySettingsChanged: true,
    });
  });

  it('deleteTierAndDegradeReferences reports no changes when nothing referenced the tier', async () => {
    const { deleteTierAndDegradeReferences } = await import('./tierDeletionService.js');
    const created = modelTiers.create({
      name: 'ChangeSet Lonely Tier',
      members: [{ providerId: providerA.id, modelId: 'changeset-model-a', position: 0 }],
    });

    const result = deleteTierAndDegradeReferences(created.id);

    expect(result.degradation).toMatchObject({
      affectedSessions: [],
      laneProjectIds: [],
      summarySettingsChanged: false,
    });
  });

  it('degradeReferencesToEmptiedTiers returns one change set per degraded tier', async () => {
    const { degradeReferencesToEmptiedTiers } = await import('./tierDeletionService.js');
    // A tier created with no members is referenced but not executable — the
    // stale self-healing path this sweep owns.
    const created = modelTiers.create({ name: 'ChangeSet Emptied Tier' });
    const tierRef = buildTierRef(created.id);
    const project = projects.create('ChangeSet Empty Project', '/tmp/changeset-empty');
    const session = sessions.create(project.id, 'ChangeSet empty session', 'Later', {
      status: 'waiting', model: tierRef,
    });

    const changeSets = degradeReferencesToEmptiedTiers();
    const own = changeSets.find((c) => c.tierId === created.id);
    expect(own).toBeTruthy();
    expect(own.degradedFrom).toBe(tierRef);
    expect(own.affectedSessions).toEqual([{ id: session.id, projectId: project.id }]);
  });
});
