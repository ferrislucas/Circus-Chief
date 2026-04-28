import { describe, it, expect } from 'vitest';
import { modelProviders, projects, sessions } from '../database.js';
import {
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
});
