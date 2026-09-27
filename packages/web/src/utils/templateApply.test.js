import { describe, it, expect } from 'vitest';
import { appendTemplatePromptValue, buildTemplateSettingsFields, resolveTemplateProviderId } from './templateApply.js';

describe('appendTemplatePromptValue', () => {
  it('returns the prompt when the current value is empty', () => {
    expect(appendTemplatePromptValue('', 'Template prompt')).toBe('Template prompt');
  });

  it('appends the prompt with a blank line separator', () => {
    expect(appendTemplatePromptValue('Existing draft', 'Template prompt'))
      .toBe('Existing draft\n\nTemplate prompt');
  });

  it('trims surrounding whitespace from both values', () => {
    expect(appendTemplatePromptValue('  Existing draft  ', '  Template prompt  '))
      .toBe('Existing draft\n\nTemplate prompt');
  });

  it('returns null for an empty or whitespace-only prompt', () => {
    expect(appendTemplatePromptValue('Existing', '')).toBeNull();
    expect(appendTemplatePromptValue('Existing', '   ')).toBeNull();
    expect(appendTemplatePromptValue('Existing', null)).toBeNull();
    expect(appendTemplatePromptValue('Existing', undefined)).toBeNull();
  });

  it('returns null when the prompt is already present at the end (no duplicate append)', () => {
    expect(appendTemplatePromptValue('Existing\n\nTemplate prompt', 'Template prompt')).toBeNull();
  });

  it('handles a null/undefined current value', () => {
    expect(appendTemplatePromptValue(null, 'Template prompt')).toBe('Template prompt');
    expect(appendTemplatePromptValue(undefined, 'Template prompt')).toBe('Template prompt');
  });
});

describe('buildTemplateSettingsFields', () => {
  it('returns an empty object for a null template', () => {
    expect(buildTemplateSettingsFields(null)).toEqual({});
  });

  it('includes mode, thinkingEnabled, and effortLevel when present', () => {
    expect(buildTemplateSettingsFields({
      mode: 'yolo',
      thinkingEnabled: true,
      effortLevel: 'high',
    })).toEqual({ mode: 'yolo', thinkingEnabled: true, effortLevel: 'high' });
  });

  it('includes thinkingEnabled: false (does not drop the falsy value)', () => {
    expect(buildTemplateSettingsFields({ thinkingEnabled: false }))
      .toEqual({ thinkingEnabled: false });
  });

  it('omits fields that are null or undefined', () => {
    expect(buildTemplateSettingsFields({
      mode: undefined,
      thinkingEnabled: null,
      effortLevel: undefined,
    })).toEqual({});
  });

  it('excludes git mode/branch, model, and nextTemplateId', () => {
    expect(buildTemplateSettingsFields({
      mode: 'standard',
      model: 'claude-opus-4-8',
      providerId: 'p1',
      gitMode: 'worktree',
      gitBranch: 'feature',
      nextTemplateId: 'next-1',
      effortLevel: 'low',
    })).toEqual({ mode: 'standard', effortLevel: 'low' });
  });
});

describe('resolveTemplateProviderId', () => {
  const providers = [
    { id: 'prov-a', isBuiltIn: true, kind: 'anthropic', models: [{ modelId: 'claude-sonnet' }] },
    { id: 'prov-b', isBuiltIn: true, kind: 'openai', models: [{ modelId: 'gpt-x' }] },
  ];

  it('honors an explicit providerId key', () => {
    expect(resolveTemplateProviderId({ model: 'gpt-x', providerId: 'prov-b' }, providers)).toBe('prov-b');
  });

  it('honors an explicit null providerId instead of the current selection', () => {
    expect(resolveTemplateProviderId({ model: 'gpt-x', providerId: null }, providers)).toBeNull();
  });

  it('forces null for tier refs even when the template carries a providerId', () => {
    expect(resolveTemplateProviderId({ model: 'tier::abc', providerId: 'prov-a' }, providers)).toBeNull();
  });

  it('resolves the owning provider when the key is absent (never the current selection)', () => {
    expect(resolveTemplateProviderId({ model: 'gpt-x' }, providers)).toBe('prov-b');
  });

  it('infers the built-in provider for a removed catalog row by model prefix', () => {
    expect(resolveTemplateProviderId({ model: 'gpt-legacy' }, providers)).toBe('prov-b');
  });

  it('returns null when the model owner is unknown', () => {
    expect(resolveTemplateProviderId({ model: 'mystery-model' }, providers)).toBeNull();
  });
});
