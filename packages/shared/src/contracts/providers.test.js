import { describe, it, expect } from 'vitest';
import {
  ProviderKind,
  CreateProviderRequest,
  UpdateProviderRequest,
  TestConnectionRequest,
} from './providers.js';

describe('Provider Contracts', () => {
  describe('ProviderKind', () => {
    it('accepts "anthropic"', () => {
      expect(ProviderKind.safeParse('anthropic').success).toBe(true);
    });

    it('accepts "openai"', () => {
      expect(ProviderKind.safeParse('openai').success).toBe(true);
    });

    it('rejects unknown values', () => {
      expect(ProviderKind.safeParse('gemini').success).toBe(false);
      expect(ProviderKind.safeParse('').success).toBe(false);
      expect(ProviderKind.safeParse(null).success).toBe(false);
    });
  });

  describe('CreateProviderRequest', () => {
    it('requires name and kind', () => {
      const ok = CreateProviderRequest.safeParse({
        name: 'OpenRouter',
        kind: 'anthropic',
        baseUrl: 'https://openrouter.ai/api/v1',
        authToken: 'sk-...',
      });
      expect(ok.success).toBe(true);
    });

    it('rejects missing kind', () => {
      const result = CreateProviderRequest.safeParse({
        name: 'No Kind',
        baseUrl: 'https://x.example.com',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid kind value', () => {
      const result = CreateProviderRequest.safeParse({
        name: 'Invalid',
        kind: 'gemini',
      });
      expect(result.success).toBe(false);
    });

    it('accepts both anthropic and openai kinds', () => {
      const a = CreateProviderRequest.safeParse({ name: 'A', kind: 'anthropic' });
      const o = CreateProviderRequest.safeParse({ name: 'O', kind: 'openai' });
      expect(a.success).toBe(true);
      expect(o.success).toBe(true);
    });

    it('accepts omitted, null, and string commit attribution override', () => {
      expect(CreateProviderRequest.safeParse({ name: 'A', kind: 'anthropic' }).success).toBe(true);
      expect(CreateProviderRequest.safeParse({
        name: 'A',
        kind: 'anthropic',
        commitAttributionOverride: null,
      }).success).toBe(true);
      expect(CreateProviderRequest.safeParse({
        name: 'A',
        kind: 'anthropic',
        commitAttributionOverride: 'Co-authored-by: Claude <noreply@anthropic.com>',
      }).success).toBe(true);
    });
  });

  describe('UpdateProviderRequest', () => {
    it('accepts partial updates', () => {
      const ok = UpdateProviderRequest.safeParse({ name: 'New Name' });
      expect(ok.success).toBe(true);
    });

    it('rejects kind in the update payload (immutable)', () => {
      const result = UpdateProviderRequest.safeParse({
        name: 'Fine',
        kind: 'openai',
      });
      expect(result.success).toBe(false);
    });

    it('rejects kind even when no other fields are present', () => {
      const result = UpdateProviderRequest.safeParse({ kind: 'anthropic' });
      expect(result.success).toBe(false);
    });

    it('accepts null and string commit attribution override updates', () => {
      expect(UpdateProviderRequest.safeParse({ commitAttributionOverride: null }).success).toBe(true);
      expect(UpdateProviderRequest.safeParse({
        commitAttributionOverride: 'Codex <noreply@openai.com>',
      }).success).toBe(true);
    });

    it('rejects non-string commit attribution override updates', () => {
      for (const value of [1, true, {}, []]) {
        expect(UpdateProviderRequest.safeParse({ commitAttributionOverride: value }).success).toBe(false);
      }
    });
  });

  describe('TestConnectionRequest', () => {
    it('requires kind', () => {
      const missing = TestConnectionRequest.safeParse({
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });
      expect(missing.success).toBe(false);

      const present = TestConnectionRequest.safeParse({
        kind: 'anthropic',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });
      expect(present.success).toBe(true);
    });

    it('accepts openai kind', () => {
      const result = TestConnectionRequest.safeParse({
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authToken: 'sk-test',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid kind', () => {
      const result = TestConnectionRequest.safeParse({
        kind: 'cohere',
        baseUrl: 'https://api.test.com',
      });
      expect(result.success).toBe(false);
    });
  });
});
