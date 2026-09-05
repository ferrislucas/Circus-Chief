import { describe, it, expect } from 'vitest';
import {
  ProviderKind,
  CreateProviderRequest,
  UpdateProviderRequest,
  TestConnectionRequest,
  COMMIT_ATTRIBUTION_VALIDATION_MESSAGE,
  parseCommitAttributionOverride,
  normalizeCommitAttributionOverride,
  ProviderAllowanceSnapshot,
  ProviderAllowanceListResponse,
  ProviderAllowanceUpdatedPayload,
} from './providers.js';

describe('Provider Contracts', () => {
  describe('ProviderAllowanceSnapshot', () => {
    it('accepts a redacted unknown snapshot and rejects unexpected fields', () => {
      const snapshot = {
        providerId: 'openai-default', providerName: 'OpenAI', providerKind: 'openai',
        status: 'unknown', allowances: [], source: null, updatedAt: null, staleAt: null,
        unavailableReason: 'No verified data',
      };
      expect(ProviderAllowanceSnapshot.safeParse(snapshot).success).toBe(true);
      expect(ProviderAllowanceSnapshot.safeParse({ ...snapshot, authToken: 'secret' }).success).toBe(false);
    });
  });

  describe('provider allowance wire contracts', () => {
    const snapshot = {
      providerId: 'openai-default', providerName: 'OpenAI', providerKind: 'openai',
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: 2,
      unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: null }],
    };

    it('accepts every allowance enum and nullable measurement field', () => {
      for (const status of ['available', 'warning', 'critical', 'exhausted', 'unknown', 'stale']) {
        for (const source of ['provider', 'observed-header', 'configured']) {
          for (const unit of ['tokens', 'requests', 'credits', 'other']) {
            expect(ProviderAllowanceSnapshot.safeParse({
              ...snapshot, status, source,
              allowances: [{ ...snapshot.allowances[0], unit, remaining: null, limit: null, remainingPercent: null, resetsAt: null }],
            }).success).toBe(true);
          }
        }
      }
    });

    it('strictly rejects invalid or secret-shaped values at every allowance level', () => {
      expect(ProviderAllowanceSnapshot.safeParse({ ...snapshot, status: 'bad' }).success).toBe(false);
      expect(ProviderAllowanceSnapshot.safeParse({ ...snapshot, allowances: [{ ...snapshot.allowances[0], remainingPercent: 101 }] }).success).toBe(false);
      expect(ProviderAllowanceSnapshot.safeParse({ ...snapshot, allowances: [{ ...snapshot.allowances[0], remaining: -1 }] }).success).toBe(false);
      expect(ProviderAllowanceSnapshot.safeParse({ ...snapshot, allowances: [{ ...snapshot.allowances[0], authToken: 'secret' }] }).success).toBe(false);
    });

    it('validates list and websocket update envelopes', () => {
      expect(ProviderAllowanceListResponse.safeParse([snapshot]).success).toBe(true);
      expect(ProviderAllowanceUpdatedPayload.safeParse({ snapshot }).success).toBe(true);
      expect(ProviderAllowanceUpdatedPayload.safeParse({ snapshot, authToken: 'secret' }).success).toBe(false);
    });
  });
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

    it('canonicalizes omitted, null, blank, and valid commit attribution overrides', () => {
      expect(CreateProviderRequest.safeParse({ name: 'A', kind: 'anthropic' }).success).toBe(true);
      expect(CreateProviderRequest.safeParse({
        name: 'A',
        kind: 'anthropic',
        commitAttributionOverride: null,
      }).data.commitAttributionOverride).toBeNull();
      expect(CreateProviderRequest.safeParse({
        name: 'A',
        kind: 'anthropic',
        commitAttributionOverride: '   ',
      }).data.commitAttributionOverride).toBeNull();
      expect(CreateProviderRequest.safeParse({
        name: 'A',
        kind: 'anthropic',
        commitAttributionOverride: 'Codex <noreply@openai.com>',
      }).data.commitAttributionOverride).toBe('Co-authored-by: Codex <noreply@openai.com>');
      expect(CreateProviderRequest.safeParse({
        name: 'A',
        kind: 'anthropic',
        commitAttributionOverride: 'Co-authored-by: Claude <noreply@anthropic.com>',
      }).data.commitAttributionOverride).toBe('Co-authored-by: Claude <noreply@anthropic.com>');
    });

    it('rejects malformed commit attribution overrides', () => {
      for (const value of [
        'noreply@openai.com',
        '<noreply@openai.com>',
        'Codex noreply@openai.com',
        'Codex <not-an-email>',
        'Codex <noreply@openai.com>\nMore',
        1,
        {},
        [],
      ]) {
        const result = CreateProviderRequest.safeParse({
          name: 'A',
          kind: 'anthropic',
          commitAttributionOverride: value,
        });
        expect(result.success).toBe(false);
        expect(result.error.issues[0].message).toBe(COMMIT_ATTRIBUTION_VALIDATION_MESSAGE);
      }
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

    it('canonicalizes null, blank, and valid commit attribution override updates', () => {
      expect(UpdateProviderRequest.safeParse({ commitAttributionOverride: null }).data.commitAttributionOverride).toBeNull();
      expect(UpdateProviderRequest.safeParse({ commitAttributionOverride: '   ' }).data.commitAttributionOverride).toBeNull();
      expect(UpdateProviderRequest.safeParse({
        commitAttributionOverride: 'Codex <noreply@openai.com>',
      }).data.commitAttributionOverride).toBe('Co-authored-by: Codex <noreply@openai.com>');
      expect(UpdateProviderRequest.safeParse({
        commitAttributionOverride: 'Co-authored-by: Codex <noreply@openai.com>',
      }).data.commitAttributionOverride).toBe('Co-authored-by: Codex <noreply@openai.com>');
    });

    it('rejects malformed commit attribution override updates', () => {
      for (const value of [
        'noreply@openai.com',
        '<noreply@openai.com>',
        'Codex noreply@openai.com',
        'Codex <not-an-email>',
        'Codex <noreply@openai.com>\nMore',
        1,
        true,
        {},
        [],
      ]) {
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

  describe('parseCommitAttributionOverride', () => {
    it('returns null for undefined', () => {
      expect(parseCommitAttributionOverride(undefined)).toEqual({ success: true, value: null });
    });

    it('returns null for null', () => {
      expect(parseCommitAttributionOverride(null)).toEqual({ success: true, value: null });
    });

    it('returns error for non-string', () => {
      expect(parseCommitAttributionOverride(123)).toEqual({ success: false, error: COMMIT_ATTRIBUTION_VALIDATION_MESSAGE });
    });

    it('returns null for empty string', () => {
      expect(parseCommitAttributionOverride('')).toEqual({ success: true, value: null });
    });

    it('returns null for whitespace-only string', () => {
      expect(parseCommitAttributionOverride('   ')).toEqual({ success: true, value: null });
    });

    it('returns error for string with newline', () => {
      expect(parseCommitAttributionOverride('Claude <a@b.com>\nmore')).toEqual({ success: false, error: COMMIT_ATTRIBUTION_VALIDATION_MESSAGE });
    });

    it('returns error for string with carriage return', () => {
      expect(parseCommitAttributionOverride('Claude <a@b.com>\rmore')).toEqual({ success: false, error: COMMIT_ATTRIBUTION_VALIDATION_MESSAGE });
    });

    it('returns error for malformed string without email brackets', () => {
      expect(parseCommitAttributionOverride('just text')).toEqual({ success: false, error: COMMIT_ATTRIBUTION_VALIDATION_MESSAGE });
    });

    it('returns error when name is only whitespace', () => {
      expect(parseCommitAttributionOverride(' <test@example.com>')).toEqual({ success: false, error: COMMIT_ATTRIBUTION_VALIDATION_MESSAGE });
    });

    it('returns canonical form for valid input', () => {
      expect(parseCommitAttributionOverride('Claude <noreply@anthropic.com>')).toEqual({
        success: true,
        value: 'Co-authored-by: Claude <noreply@anthropic.com>',
      });
    });

    it('strips co-authored-by prefix', () => {
      expect(parseCommitAttributionOverride('Co-authored-by: Codex <noreply@openai.com>')).toEqual({
        success: true,
        value: 'Co-authored-by: Codex <noreply@openai.com>',
      });
    });
  });

  describe('normalizeCommitAttributionOverride', () => {
    it('returns null for null input', () => {
      expect(normalizeCommitAttributionOverride(null)).toBeNull();
    });

    it('returns canonical form for valid input', () => {
      expect(normalizeCommitAttributionOverride('Claude <noreply@anthropic.com>')).toBe(
        'Co-authored-by: Claude <noreply@anthropic.com>'
      );
    });

    it('throws for invalid input', () => {
      expect(() => normalizeCommitAttributionOverride('invalid')).toThrow(COMMIT_ATTRIBUTION_VALIDATION_MESSAGE);
    });

    it('throws for non-string input', () => {
      expect(() => normalizeCommitAttributionOverride(42)).toThrow(COMMIT_ATTRIBUTION_VALIDATION_MESSAGE);
    });
  });
});
