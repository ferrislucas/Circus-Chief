import { describe, it, expect } from 'vitest';
import { modelProviders, projects, sessions } from '../database.js';
import {
  BUILT_IN_ANTHROPIC_PROVIDER_ID,
  BUILT_IN_OPENAI_PROVIDER_ID,
  DEFAULT_ANTHROPIC_SUMMARY_MODEL,
  DEFAULT_OPENAI_SUMMARY_MODEL,
  resolveSummaryModel,
} from './summaryModelResolver.js';

describe('summaryModelResolver', () => {
  it('falls back to Haiku when no explicit setting or built-in usage exists', () => {
    const resolved = resolveSummaryModel({});

    expect(resolved).toMatchObject({
      model: DEFAULT_ANTHROPIC_SUMMARY_MODEL,
      kind: 'anthropic',
      providerId: null,
      isDefault: true,
      selectionReason: 'fallback',
    });
  });

  it('resolves an explicit built-in OpenAI model to the OpenAI provider', () => {
    const resolved = resolveSummaryModel({
      summaryModel: DEFAULT_OPENAI_SUMMARY_MODEL,
      summaryProviderId: 'openai-default',
    });

    expect(resolved).toMatchObject({
      model: DEFAULT_OPENAI_SUMMARY_MODEL,
      kind: 'openai',
      providerId: 'openai-default',
      isDefault: false,
      selectionReason: 'explicit',
    });
  });

  it('prefers provider id for duplicate explicit model ids', () => {
    const provider = modelProviders.create({
      name: 'Summary Resolver OpenAI',
      kind: 'openai',
      baseUrl: 'https://example.test/v1',
      authToken: 'token',
    });
    modelProviders.addModel(provider.id, {
      modelId: DEFAULT_OPENAI_SUMMARY_MODEL,
      displayName: 'Custom Mini',
    });

    const resolved = resolveSummaryModel({
      summaryModel: DEFAULT_OPENAI_SUMMARY_MODEL,
      summaryProviderId: provider.id,
    });

    expect(resolved.providerId).toBe(provider.id);
    expect(resolved.provider).toMatchObject({ id: provider.id, kind: 'openai' });

    modelProviders.delete(provider.id);
  });

  it('skips recent custom-provider usage and uses the next built-in provider family', () => {
    const project = projects.create('Summary Resolver Project', '/tmp/summary-resolver');
    sessions.create(project.id, 'OpenAI built-in', 'prompt', {
      model: DEFAULT_OPENAI_SUMMARY_MODEL,
      providerId: 'openai-default',
      status: 'completed',
    });

    const provider = modelProviders.create({
      name: 'Recent Custom Provider',
      kind: 'openai',
      baseUrl: 'https://example.test/v1',
      authToken: 'token',
    });
    modelProviders.addModel(provider.id, {
      modelId: 'custom-summary-model',
      displayName: 'Custom Summary Model',
    });
    sessions.create(project.id, 'Custom recent', 'prompt', {
      model: 'custom-summary-model',
      providerId: provider.id,
      status: 'completed',
    });

    const resolved = resolveSummaryModel({ summaryModel: '', summaryProviderId: null });

    expect(resolved).toMatchObject({
      model: DEFAULT_OPENAI_SUMMARY_MODEL,
      kind: 'openai',
      providerId: 'openai-default',
      isDefault: true,
      selectionReason: 'recent-built-in-provider',
    });

    modelProviders.delete(provider.id);
  });

  it('uses message activity recency ahead of a newer session row update', () => {
    const project = projects.create('Summary Resolver Activity Project', '/tmp/summary-resolver-activity');
    const now = Date.now();
    const olderSession = sessions.create(project.id, 'Older active OpenAI', 'prompt', {
      model: DEFAULT_OPENAI_SUMMARY_MODEL,
      providerId: BUILT_IN_OPENAI_PROVIDER_ID,
      status: 'completed',
    });
    const newerSession = sessions.create(project.id, 'Newer inactive Anthropic', 'prompt', {
      model: DEFAULT_ANTHROPIC_SUMMARY_MODEL,
      providerId: BUILT_IN_ANTHROPIC_PROVIDER_ID,
      status: 'completed',
    });

    sessions.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now - 10_000, olderSession.id);
    sessions.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, newerSession.id);
    sessions.db
      .prepare('INSERT INTO conversation_messages (id, session_id, role, content, model, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
      .run('summary-resolver-active-message', olderSession.id, 'assistant', 'done', DEFAULT_OPENAI_SUMMARY_MODEL, now + 10_000);

    const resolved = resolveSummaryModel({ summaryModel: '', summaryProviderId: null });

    expect(resolved).toMatchObject({
      model: DEFAULT_OPENAI_SUMMARY_MODEL,
      kind: 'openai',
      providerId: BUILT_IN_OPENAI_PROVIDER_ID,
      selectionReason: 'recent-built-in-provider',
    });
  });

  it('falls back to updated and created timestamps when sessions have no messages', () => {
    const project = projects.create('Summary Resolver No Messages Project', '/tmp/summary-resolver-no-messages');
    const now = Date.now();
    const anthSession = sessions.create(project.id, 'Anthropic older', 'prompt', {
      model: DEFAULT_ANTHROPIC_SUMMARY_MODEL,
      providerId: BUILT_IN_ANTHROPIC_PROVIDER_ID,
      status: 'completed',
    });
    const openaiSession = sessions.create(project.id, 'OpenAI newer', 'prompt', {
      model: DEFAULT_OPENAI_SUMMARY_MODEL,
      providerId: BUILT_IN_OPENAI_PROVIDER_ID,
      status: 'completed',
    });

    sessions.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now - 10_000, anthSession.id);
    sessions.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now + 10_000, openaiSession.id);

    const resolved = resolveSummaryModel({ summaryModel: '', summaryProviderId: null });

    expect(resolved).toMatchObject({
      model: DEFAULT_OPENAI_SUMMARY_MODEL,
      providerId: BUILT_IN_OPENAI_PROVIDER_ID,
      selectionReason: 'recent-built-in-provider',
    });
  });

  it('throws for model-only explicit settings', () => {
    expect(() => resolveSummaryModel({
      summaryModel: DEFAULT_OPENAI_SUMMARY_MODEL,
      summaryProviderId: null,
    })).toThrow('summaryProviderId is required');
  });

  it('throws for provider-only explicit settings', () => {
    expect(() => resolveSummaryModel({
      summaryModel: '',
      summaryProviderId: BUILT_IN_OPENAI_PROVIDER_ID,
    })).toThrow('summaryModel is required');
  });

  it('retains built-in Anthropic provider identity for explicit settings', () => {
    const resolved = resolveSummaryModel({
      summaryModel: DEFAULT_ANTHROPIC_SUMMARY_MODEL,
      summaryProviderId: BUILT_IN_ANTHROPIC_PROVIDER_ID,
    });

    expect(resolved).toMatchObject({
      model: DEFAULT_ANTHROPIC_SUMMARY_MODEL,
      kind: 'anthropic',
      providerId: BUILT_IN_ANTHROPIC_PROVIDER_ID,
      selectionReason: 'explicit',
    });
    expect(resolved.provider).toMatchObject({ id: BUILT_IN_ANTHROPIC_PROVIDER_ID, isBuiltIn: true });
  });
});
