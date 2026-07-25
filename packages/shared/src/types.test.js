import { describe, it, expect } from 'vitest';
import { CLAUDE_MODELS, OPENAI_MODELS, GEMINI_MODELS, DEFAULT_OPENAI_MODEL } from './types.js';

describe('catalog matrix completeness (FRD §0 / Phase 1 gate)', () => {
  const catalogs = { CLAUDE_MODELS, OPENAI_MODELS, GEMINI_MODELS };

  for (const [name, models] of Object.entries(catalogs)) {
    describe(name, () => {
      it('has at least one entry', () => {
        expect(models.length).toBeGreaterThan(0);
      });

      it('every entry has lifecycle, evidence, reviewedDate, and a seedId', () => {
        for (const model of models) {
          expect(['current', 'older']).toContain(model.lifecycle);
          expect(model.evidence).toBeTypeOf('string');
          expect(model.evidence.length).toBeGreaterThan(0);
          expect(model.reviewedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(model.seedId).toBeTypeOf('string');
          expect(model.seedId.length).toBeGreaterThan(0);
        }
      });

      it('defaultEnabled matches lifecycle (current => true, older => false)', () => {
        for (const model of models) {
          expect(model.defaultEnabled).toBe(model.lifecycle === 'current');
        }
      });

      it('has no duplicate ids or seed ids', () => {
        const ids = models.map((m) => m.id);
        const seedIds = models.map((m) => m.seedId);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(seedIds).size).toBe(seedIds.length);
      });
    });
  }

  it('classifies superseded Claude Opus generations as older, disabled by default', () => {
    expect(CLAUDE_MODELS.find((m) => m.id === 'claude-opus-4-6')).toMatchObject({ lifecycle: 'older', defaultEnabled: false });
    expect(CLAUDE_MODELS.find((m) => m.id === 'claude-opus-4-7')).toMatchObject({ lifecycle: 'older', defaultEnabled: false });
    expect(CLAUDE_MODELS.find((m) => m.id === 'claude-opus-4-8')).toMatchObject({ lifecycle: 'current', defaultEnabled: true });
  });

  it('classifies superseded GPT-5.x generations as older, disabled by default', () => {
    for (const id of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.5']) {
      expect(OPENAI_MODELS.find((m) => m.id === id)).toMatchObject({ lifecycle: 'older', defaultEnabled: false });
    }
    for (const id of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      expect(OPENAI_MODELS.find((m) => m.id === id)).toMatchObject({ lifecycle: 'current', defaultEnabled: true });
    }
  });

  it('classifies every Gemini entry as current (no superseded sibling in this catalog)', () => {
    for (const model of GEMINI_MODELS) {
      expect(model.lifecycle).toBe('current');
      expect(model.defaultEnabled).toBe(true);
    }
  });
});

describe('OPENAI_MODELS', () => {
  it('includes the GPT-5.6 family', () => {
    const ids = OPENAI_MODELS.map((m) => m.id);
    expect(ids).toContain('gpt-5.6-sol');
    expect(ids).toContain('gpt-5.6-terra');
    expect(ids).toContain('gpt-5.6-luna');
  });

  it('includes gpt-5.5 as a disabled-by-default legacy choice', () => {
    const ids = OPENAI_MODELS.map((m) => m.id);
    expect(ids).toContain('gpt-5.5');
    expect(OPENAI_MODELS.find((m) => m.id === 'gpt-5.5')).toMatchObject({ defaultEnabled: false });
  });

  it('gives each GPT-5.6 model a stable seed id and display name', () => {
    expect(OPENAI_MODELS.find((m) => m.id === 'gpt-5.6-sol')).toMatchObject({
      name: 'GPT-5.6 Sol',
      seedId: 'openai-gpt-5-6-sol',
    });
    expect(OPENAI_MODELS.find((m) => m.id === 'gpt-5.6-terra')).toMatchObject({
      name: 'GPT-5.6 Terra',
      seedId: 'openai-gpt-5-6-terra',
    });
    expect(OPENAI_MODELS.find((m) => m.id === 'gpt-5.6-luna')).toMatchObject({
      name: 'GPT-5.6 Luna',
      seedId: 'openai-gpt-5-6-luna',
    });
  });

  it('does not expose the gpt-5.6 alias as a separate choice', () => {
    const ids = OPENAI_MODELS.map((m) => m.id);
    expect(ids).not.toContain('gpt-5.6');
  });
});

describe('DEFAULT_OPENAI_MODEL', () => {
  it('defaults to gpt-5.6-sol', () => {
    expect(DEFAULT_OPENAI_MODEL).toBe('gpt-5.6-sol');
  });
});
