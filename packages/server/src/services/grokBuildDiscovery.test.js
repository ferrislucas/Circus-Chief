import { describe, expect, it } from 'vitest';
import { parseGrokModelsOutput, upsertGrokModels, XAI_PROVIDER_ID } from './grokBuildDiscovery.js';

describe('grok model discovery', () => {
  it('parses JSON and plain model lists and drops junk', () => {
    expect(parseGrokModelsOutput('{"models":[{"id":"grok-build"},{"id":"not an id"}]}')).toEqual(['grok-build']);
    expect(parseGrokModelsOutput('MODEL\ngrok-build\n')).toEqual(['grok-build']);
    expect(parseGrokModelsOutput('')).toEqual([]);
  });

  it('upserts only new ids onto the built-in provider', () => {
    const added = [];
    const providers = {
      getById: () => ({ id: XAI_PROVIDER_ID, models: [{ modelId: 'grok-build' }] }),
      addModel: (_id, data) => added.push(data.modelId),
    };
    expect(upsertGrokModels(providers, ['grok-build', 'grok-4'])).toEqual(['grok-4']);
    expect(added).toEqual(['grok-4']);
  });
});
