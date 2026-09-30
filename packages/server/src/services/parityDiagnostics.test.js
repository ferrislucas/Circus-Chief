import { describe, it, expect } from 'vitest';
import {
  SECRET_KEY_PATTERN,
  redactSecretsFromText,
  buildParityCredentialError,
  checkParitySignals,
} from './parityDiagnostics.js';

describe('parityDiagnostics (FR-8, FR-11)', () => {
  describe('SECRET_KEY_PATTERN', () => {
    it('matches _PAT-suffixed keys like GITHUB_PAT', () => {
      expect(SECRET_KEY_PATTERN.test('GITHUB_PAT')).toBe(true);
    });

    it('matches _KEY-suffixed keys', () => {
      expect(SECRET_KEY_PATTERN.test('MY_ENCRYPTION_KEY')).toBe(true);
    });

    it('does not treat PATH as a secret key', () => {
      expect(SECRET_KEY_PATTERN.test('PATH')).toBe(false);
    });
  });

  describe('redactSecretsFromText', () => {
    it('scrubs a GH_TOKEN value echoed inside a multi-line stderr blob', () => {
      const secret = 'ghp_TEST_SENTINEL_XYZ_123';
      const blob = [
        'gh: failed to fetch repo',
        `caused by: request failed with ${secret} in header`,
        'hint: run `gh auth status` to re-authenticate',
      ].join('\n');
      const out = redactSecretsFromText(blob, { GH_TOKEN: secret });
      expect(out).not.toContain(secret);
      expect(out).toContain('[REDACTED]');
      expect(out).toContain('gh auth status');
    });

    it('scrubs a custom additionalEnvVars secret (GITHUB_PAT) when its value appears', () => {
      const secret = 'pat_TEST_SENTINEL_PAT_456';
      const out = redactSecretsFromText(
        `auth failed for token ${secret} retrying in /home/u/work`,
        { GITHUB_PAT: secret, HOME: '/home/u' },
      );
      expect(out).not.toContain(secret);
      expect(out).toContain('[REDACTED]');
      expect(out).toContain('/home/u');
    });
  });

  describe('buildParityCredentialError', () => {
    it('is actionable and secret-free for ssh-agent', () => {
      const err = buildParityCredentialError('ssh-agent');
      expect(err.code).toBe('MUSE_SSH_AGENT_UNREACHABLE');
      expect(err.message).toMatch(/SSH_AUTH_SOCK/);
      expect(err.message).toMatch(/ssh-add/);
    });

    it('never interpolates caller values', () => {
      const err = buildParityCredentialError('gh-auth');
      expect(err.code).toBe('MUSE_GH_UNAUTHENTICATED');
      expect(err.message).not.toContain('TEST_SENTINEL');
    });
  });

  describe('checkParitySignals', () => {
    it('reports ssh-agent failure without leaking the socket value', () => {
      const signals = checkParitySignals(
        { SSH_AUTH_SOCK: '/nonexistent-dir-xyz/agent.sock' },
        { skipBinaries: true },
      );
      const ssh = signals.find((s) => s.signal === 'ssh-agent');
      expect(ssh.ok).toBe(false);
      expect(ssh.remediation).toMatch(/ssh-add/);
      expect(JSON.stringify(ssh)).not.toContain('nonexistent-dir-xyz');
    });
  });
});
