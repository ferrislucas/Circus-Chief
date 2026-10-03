import { describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SECRET_KEY_PATTERN,
  harvestGhHostsTokens,
  redactSecretsFromText,
  buildParityCredentialError,
  checkParitySignals,
  scrubEventForLogging,
  __resetGhHostsTokenCacheForTest,
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

    // Finding #10: the pattern is boundary-anchored — keys that merely
    // CONTAIN TOKEN/KEY/SECRET mid-name are benign, and scrubbing their
    // values (e.g. directory paths) corrupts every agent's tool logs.
    it.each([
      'PATH_TO_TOKENS_DIR',
      'TOKENIZER_HOME',
      'KEYBOARD_LAYOUT',
      'MONKEY_PATH',
      'SECRETS_DOC_DIR',
      'KEYS_INDEX_ROOT',
    ])('does not treat benign mid-name key %s as a secret key (finding #10)', (key) => {
      expect(SECRET_KEY_PATTERN.test(key)).toBe(false);
    });

    it.each([
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'SSH_PRIVATE_KEY',
      'SERVER_PRIVATE',
      'GITHUB_PAT',
      'APP_SECRET',
      'DB_PASSWORD',
      'TOKEN',
      'ENCRYPTION_KEY',
    ])('still treats %s as a secret key (finding #10)', (key) => {
      expect(SECRET_KEY_PATTERN.test(key)).toBe(true);
    });

    it('no longer scrubs a benign PATH_TO_TOKENS_DIR value from output (finding #10)', () => {
      const out = redactSecretsFromText(
        'token cache lives under /var/path-to-tokens-dir/cache',
        { PATH_TO_TOKENS_DIR: '/var/path-to-tokens-dir/cache' },
      );
      expect(out).toContain('/var/path-to-tokens-dir/cache');
      expect(out).not.toContain('[REDACTED]');
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

  // Finding #2(b): gh CLI credentials often live only in
  // ~/.config/gh/hosts.yml (oauth_token) — a tool output that echoes that
  // token would otherwise bypass the env-keyed scrub. The harvested values
  // join the per-turn scrub set, held in memory only.
  describe('gh-hosts token harvesting (finding #2)', () => {
    async function writeFixtureHostsYml(yaml) {
      const home = await mkdtemp(join(tmpdir(), 'gh-hosts-fixture-'));
      const ghDir = join(home, '.config', 'gh');
      await mkdir(ghDir, { recursive: true });
      await writeFile(join(ghDir, 'hosts.yml'), yaml);
      return home;
    }

    it('harvests oauth_token values (nested users + host-level) from hosts.yml', async () => {
      const home = await writeFixtureHostsYml([
        'github.com:',
        '    users:',
        '        octocat:',
        '            oauth_token: ghp_fixture_user_token_1',
        '    oauth_token: ghp_fixture_host_token_2',
        '    user: octocat',
        'gitlab.com:',
        '    oauth_token: ghp_fixture_gitlab_token_3',
        '',
      ].join('\n'));
      __resetGhHostsTokenCacheForTest();
      try {
        expect(harvestGhHostsTokens({ HOME: home })).toEqual([
          'ghp_fixture_user_token_1',
          'ghp_fixture_host_token_2',
          'ghp_fixture_gitlab_token_3',
        ]);
      } finally {
        __resetGhHostsTokenCacheForTest();
      }
    });

    it('scrubs a hosts.yml token echoed in tool output via scrubEventForLogging', async () => {
      const home = await writeFixtureHostsYml('github.com:\n    oauth_token: ghp_fixture_leaked_token\n');
      __resetGhHostsTokenCacheForTest();
      try {
        const out = scrubEventForLogging('fatal: bad credentials for ghp_fixture_leaked_token', { HOME: home });
        expect(out).toBe('fatal: bad credentials for [REDACTED]');
      } finally {
        __resetGhHostsTokenCacheForTest();
      }
    });

    it('yields no extra values when hosts.yml is missing or unreadable', () => {
      __resetGhHostsTokenCacheForTest();
      try {
        expect(harvestGhHostsTokens({ HOME: join(tmpdir(), 'no-such-home-xyz') })).toEqual([]);
        expect(harvestGhHostsTokens({})).toEqual([]);
      } finally {
        __resetGhHostsTokenCacheForTest();
      }
    });

    it('does not let a hosts.yml token scrub through redactSecretsFromText (env-only contract)', () => {
      // redactSecretsFromText stays pure: env-keyed values only. Harvesting
      // is a property of the session scrub path (scrubEventForLogging).
      const out = redactSecretsFromText('plain text ghp_fixture_leaked_token', { HOME: '/tmp' });
      expect(out).toContain('ghp_fixture_leaked_token');
    });
  });
});
