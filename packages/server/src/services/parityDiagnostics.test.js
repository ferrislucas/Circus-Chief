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
      // Round-3 finding #3: the unanchored API_KEY alternative matched these.
      'API_KEYS_PATH',
      'MY_API_KEY_BACKUP',
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
      'API_KEY',
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

    // Round-3 finding #4: a 1–2 character "secret" must not nuke every
    // occurrence of that character in transcripts.
    it.each([
      ['redactSecretsFromText', (text, env) => redactSecretsFromText(text, env)],
      ['scrubEventForLogging', (text, env) => scrubEventForLogging(text, env)],
    ])('%s leaves sub-floor secret values untouched', (_name, scrub) => {
      const out = scrub('abacus ab ba', { GH_TOKEN: 'ab', GITHUB_PAT: 'x' });
      expect(out).toBe('abacus ab ba');
      expect(out).not.toContain('[REDACTED]');
    });

    it('still scrubs normal-length values after the floor lands', () => {
      const secret = 'SENTINEL_LONG_ENOUGH_1';
      for (const scrub of [(t, e) => redactSecretsFromText(t, e), (t, e) => scrubEventForLogging(t, e)]) {
        expect(scrub(`leaked ${secret} here`, { GH_TOKEN: secret })).toBe('leaked [REDACTED] here');
      }
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

    // Round-3 finding #6: quoted oauth_token values must harvest bare —
    // otherwise a raw unquoted echo never matches the scrub set.
    it.each([
      ['double-quoted', 'oauth_token: "QUOTED_DQ_TOKEN_R3"'],
      ['single-quoted', "oauth_token: 'QUOTED_SQ_TOKEN_R3'"],
      ['unquoted', 'oauth_token: BARE_TOKEN_R3'],
    ])('harvests the bare token from a %s hosts.yml line', async (_label, line) => {
      const home = await writeFixtureHostsYml(`github.com:\n    ${line}\n`);
      __resetGhHostsTokenCacheForTest();
      try {
        const tokens = harvestGhHostsTokens({ HOME: home });
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).not.toMatch(/['"]/);
        expect(`echoed ${tokens[0]} here`).toContain(tokens[0]);
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
