import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync, existsSync } from 'fs';
import { execFileSync, spawn, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  TlsError,
  buildSelfSignedSans,
  detectPublicIp,
  getLanIPv4s,
  getDefaultTlsDir,
  resolveTlsConfig,
} from './tls.js';

/**
 * Deterministic stand-in for https.get. Simulates a response with the given
 * status/body, a request-level failure, or a hang that ends in a timeout.
 */
let hasOpenssl = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  hasOpenssl = false;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Generate a real, matching cert/key pair with openssl. Skipped without openssl. */
function makeRealPair() {
  if (!hasOpenssl) throw new Error('openssl required for TLS fixtures');
  const dir = mkdtempSync(join(tmpdir(), 'tls-real-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost'],
    { stdio: 'ignore' }
  );
  return { dir, keyPath, certPath };
}

/** Generate a cert with an encrypted key (no passphrase will be supplied). */
function makeEncryptedPair() {
  if (!hasOpenssl) throw new Error('openssl required for TLS fixtures');
  const dir = mkdtempSync(join(tmpdir(), 'tls-enc-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-days', '1',
      '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost',
      '-passout', 'pass:testpass'],
    { stdio: 'ignore' }
  );
  return { dir, keyPath, certPath };
}

function fakeGet({ statusCode = 200, body = '', fail = null, hang = false } = {}) {
  return (url, opts, cb) => {
    const handlers = {};
    const req = {
      on: (ev, fn) => {
        handlers[ev] = fn;
        return req;
      },
      destroy: vi.fn(),
    };
    if (fail) {
      queueMicrotask(() => handlers.error?.(new Error(fail)));
    } else if (hang) {
      queueMicrotask(() => handlers.timeout?.());
    } else {
      queueMicrotask(() => {
        const resHandlers = {};
        const res = {
          statusCode,
          on: (ev, fn) => {
            resHandlers[ev] = fn;
            return res;
          },
        };
        cb(res);
        queueMicrotask(() => {
          if (body) resHandlers.data?.(body);
          resHandlers.end?.();
        });
      });
    }
    return req;
  };
}

describe('resolveTlsConfig', () => {
  it('returns disabled when no TLS flags are passed', async () => {
    await expect(resolveTlsConfig({})).resolves.toEqual({ enabled: false });
  });

  it('rejects exactly one of cert/key', async () => {
    await expect(resolveTlsConfig({ sslCert: 'a.pem' })).rejects.toThrow(TlsError);
    await expect(resolveTlsConfig({ sslCert: 'a.pem' })).rejects.toThrow(/both or neither/);
    await expect(resolveTlsConfig({ sslKey: 'k.pem' })).rejects.toThrow(/both or neither/);
  });

  it('rejects --self-signed combined with explicit cert/key', async () => {
    await expect(
      resolveTlsConfig({ selfSigned: true, sslCert: 'a.pem', sslKey: 'k.pem' })
    ).rejects.toThrow(/Pick one/);
  });

  it.skipIf(!hasOpenssl)('loads a custom PEM pair', async () => {
    const pair = makeRealPair();
    const config = await resolveTlsConfig({ sslCert: pair.certPath, sslKey: pair.keyPath });
    expect(config.enabled).toBe(true);
    expect(config.source).toBe('custom');
    expect(config.cert).toContain('BEGIN CERTIFICATE');
    expect(config.key).toContain('PRIVATE KEY');
  });

  it.skipIf(!hasOpenssl)('rejects a custom pair with a mismatched private key', async () => {
    const a = makeRealPair();
    const b = makeRealPair();
    await expect(
      resolveTlsConfig({ sslCert: a.certPath, sslKey: b.keyPath })
    ).rejects.toThrow(TlsError);
    await expect(
      resolveTlsConfig({ sslCert: a.certPath, sslKey: b.keyPath })
    ).rejects.toThrow(new RegExp(escapeRegExp(a.certPath)));
  });

  it.skipIf(!hasOpenssl)('rejects a truncated custom certificate', async () => {
    const pair = makeRealPair();
    const cert = readFileSync(pair.certPath, 'utf-8');
    writeFileSync(pair.certPath, cert.slice(0, Math.floor(cert.length / 2)));
    await expect(
      resolveTlsConfig({ sslCert: pair.certPath, sslKey: pair.keyPath })
    ).rejects.toThrow(TlsError);
  });

  it.skipIf(!hasOpenssl)('rejects an encrypted custom key without a passphrase', async () => {
    const pair = makeEncryptedPair();
    await expect(
      resolveTlsConfig({ sslCert: pair.certPath, sslKey: pair.keyPath })
    ).rejects.toThrow(TlsError);
  });

  it('fails with resolved paths on missing custom files', async () => {
    const missing = join(tmpdir(), 'tls-nope', 'cert.pem');
    await expect(
      resolveTlsConfig({ sslCert: missing, sslKey: join(tmpdir(), 'tls-nope', 'key.pem') })
    ).rejects.toThrow(new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('rejects non-PEM custom files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tls-badpem-'));
    const certPath = join(dir, 'cert.pem');
    const keyPath = join(dir, 'key.pem');
    writeFileSync(certPath, 'not a cert');
    writeFileSync(keyPath, 'not a key');
    await expect(resolveTlsConfig({ sslCert: certPath, sslKey: keyPath })).rejects.toThrow(/PEM/);
  });

  it.skipIf(!hasOpenssl)('reuses an existing self-signed pair without invoking openssl', async () => {
    const pair = makeRealPair();
    const dir = dirname(pair.certPath);
    writeFileSync(join(dir, 'cert.pem'), readFileSync(pair.certPath, 'utf-8'));
    writeFileSync(join(dir, 'key.pem'), readFileSync(pair.keyPath, 'utf-8'));
    const run = vi.fn();

    const config = await resolveTlsConfig({ selfSigned: true, tlsDir: dir }, { run });
    expect(config).toMatchObject({ enabled: true, source: 'self-signed', reused: true });
    expect(run).not.toHaveBeenCalled();
  });

  it.skipIf(!hasOpenssl)('rejects an invalid persisted self-signed pair instead of reusing it', async () => {
    const a = makeRealPair();
    const b = makeRealPair();
    const dir = mkdtempSync(join(tmpdir(), 'tls-badreuse-'));
    writeFileSync(join(dir, 'cert.pem'), readFileSync(a.certPath, 'utf-8'));
    writeFileSync(join(dir, 'key.pem'), readFileSync(b.keyPath, 'utf-8'));
    const run = vi.fn();
    await expect(resolveTlsConfig({ selfSigned: true, tlsDir: dir }, { run })).rejects.toThrow(TlsError);
    expect(run).not.toHaveBeenCalled();
  });

  it.skipIf(!hasOpenssl)('generates a self-signed pair via openssl and sets key mode 0600', async () => {
    const dir = join(tmpdir(), `tls-gen-${Date.now()}`);
    // The stub stands in for openssl but must emit a real, matching pair:
    // generated material is cryptographically validated before use.
    const stub = makeRealPair();
    const stubKey = readFileSync(stub.keyPath, 'utf-8');
    const stubCert = readFileSync(stub.certPath, 'utf-8');
    const run = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      const keyOut = args[args.indexOf('-keyout') + 1];
      const certOut = args[args.indexOf('-out') + 1];
      writeFileSync(keyOut, stubKey);
      writeFileSync(certOut, stubCert);
      return Buffer.from('');
    });

    const config = await resolveTlsConfig(
      { selfSigned: true, tlsDir: dir },
      { run, detectPublicIp: async () => '203.0.113.7', interfaces: {}, host: 'testhost' }
    );
    expect(config).toMatchObject({ enabled: true, source: 'self-signed', reused: false });
    expect(readFileSync(join(dir, 'cert.pem'), 'utf-8')).toBe(stubCert);
    expect(statSync(join(dir, 'key.pem')).mode & 0o777).toBe(0o600);
    // The certificate is trust material for agent processes: readable regardless of umask.
    expect(statSync(join(dir, 'cert.pem')).mode & 0o777).toBe(0o644);
    // openssl version probe + generation
    expect(run.mock.calls.filter(([cmd]) => cmd === 'openssl')).toHaveLength(2);

    const genArgs = run.mock.calls.find(([, args]) => args.includes('-keyout'))[1];
    // -x509 self-signing needs -extensions or the cert ships SAN-less.
    expect(genArgs).toEqual(expect.arrayContaining(['-extensions', 'ext']));
    const opensslConfig = readFileSync(genArgs[genArgs.indexOf('-config') + 1], 'utf-8');
    expect(opensslConfig).toContain('DNS.1 = localhost');
    expect(opensslConfig).toContain('DNS.2 = testhost');
    expect(opensslConfig).toContain('IP.1 = 127.0.0.1');
    expect(opensslConfig).toContain('IP.2 = ::1');
    expect(opensslConfig).toContain('203.0.113.7');
  });

  it('errors with install guidance when openssl is missing', async () => {
    const dir = join(tmpdir(), `tls-noopenssl-${Date.now()}`);
    const run = vi.fn(() => {
      throw Object.assign(new Error('spawn openssl ENOENT'), { code: 'ENOENT' });
    });
    await expect(
      resolveTlsConfig({ selfSigned: true, tlsDir: dir }, { run, detectPublicIp: async () => null })
    ).rejects.toThrow(/openssl.*not found/i);
  });

  it.skipIf(!hasOpenssl)('warns and continues when public-IP detection fails', async () => {
    const dir = join(tmpdir(), `tls-offline-${Date.now()}`);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stub = makeRealPair();
    const stubKey = readFileSync(stub.keyPath, 'utf-8');
    const stubCert = readFileSync(stub.certPath, 'utf-8');
    const run = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      writeFileSync(args[args.indexOf('-keyout') + 1], stubKey);
      writeFileSync(args[args.indexOf('-out') + 1], stubCert);
      return Buffer.from('');
    });
    try {
      await resolveTlsConfig(
        { selfSigned: true, tlsDir: dir },
        { run, detectPublicIp: async () => null, interfaces: {}, host: 'h' }
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Public IP could not be detected'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('propagates openssl generation failure as TlsError', async () => {
    const dir = join(tmpdir(), `tls-genfail-${Date.now()}`);
    const run = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      throw new Error('req failed');
    });
    await expect(
      resolveTlsConfig({ selfSigned: true, tlsDir: dir }, { run, detectPublicIp: async () => null })
    ).rejects.toThrow(/generation failed/);
  });
});

describe('buildSelfSignedSans', () => {
  it('always includes loopback entries', () => {
    const sans = buildSelfSignedSans({});
    expect(sans.dns).toContain('localhost');
    expect(sans.ips).toEqual(expect.arrayContaining(['127.0.0.1', '::1']));
  });

  it('adds LAN ips, hostname, and public ip without duplicates', () => {
    const sans = buildSelfSignedSans({
      lanIps: ['192.168.1.50', '127.0.0.1'],
      host: 'mybox',
      publicIp: '203.0.113.7',
    });
    expect(sans.dns).toEqual(['localhost', 'mybox']);
    expect(sans.ips).toEqual(['127.0.0.1', '::1', '192.168.1.50', '203.0.113.7']);
  });
});

describe('getLanIPv4s', () => {
  it('returns only non-internal IPv4 addresses, deduplicated', () => {
    const interfaces = {
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      eth0: [
        { family: 'IPv4', internal: false, address: '192.168.1.50' },
        { family: 'IPv6', internal: false, address: 'fe80::1' },
      ],
      wlan0: [{ family: 'IPv4', internal: false, address: '192.168.1.50' }],
    };
    expect(getLanIPv4s(interfaces)).toEqual(['192.168.1.50']);
  });
});

describe('getDefaultTlsDir', () => {
  it('lives under ~/.circuschief/tls', () => {
    expect(getDefaultTlsDir()).toMatch(/\.circuschief.tls$/);
  });
});

describe('detectPublicIp', () => {
  it('resolves a valid IPv4 address', async () => {
    await expect(
      detectPublicIp({ get: fakeGet({ statusCode: 200, body: '203.0.113.7' }) })
    ).resolves.toBe('203.0.113.7');
  });

  it('trims whitespace around a valid IPv6 address', async () => {
    await expect(
      detectPublicIp({ get: fakeGet({ statusCode: 200, body: '  2001:db8::1\n' }) })
    ).resolves.toBe('2001:db8::1');
  });

  it('rejects an IP-looking body on a non-success status', async () => {
    await expect(
      detectPublicIp({ get: fakeGet({ statusCode: 500, body: '203.0.113.7' }) })
    ).resolves.toBeNull();
  });

  it('rejects an empty body', async () => {
    await expect(detectPublicIp({ get: fakeGet({ statusCode: 200, body: '' }) })).resolves.toBeNull();
  });

  it.each(['bad', '999.999.999.999', '::::'])('rejects invalid IP body %p', async (body) => {
    await expect(detectPublicIp({ get: fakeGet({ statusCode: 200, body }) })).resolves.toBeNull();
  });

  it('resolves null on timeout', async () => {
    await expect(detectPublicIp({ get: fakeGet({ hang: true }) })).resolves.toBeNull();
  });

  it('resolves null on request failure', async () => {
    await expect(detectPublicIp({ get: fakeGet({ fail: 'ENOTFOUND' }) })).resolves.toBeNull();
  });

  it.skipIf(!hasOpenssl)('rejected discovery still generates a usable cert with loopback/LAN SANs and warns', async () => {
    const dir = join(tmpdir(), `tls-badpublicip-${Date.now()}`);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stub = makeRealPair();
    const stubKey = readFileSync(stub.keyPath, 'utf-8');
    const stubCert = readFileSync(stub.certPath, 'utf-8');
    const run = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      writeFileSync(args[args.indexOf('-keyout') + 1], stubKey);
      writeFileSync(args[args.indexOf('-out') + 1], stubCert);
      return Buffer.from('');
    });
    try {
      const config = await resolveTlsConfig(
        { selfSigned: true, tlsDir: dir },
        { run, detectPublicIp: async () => '999.999.999.999', interfaces: {}, host: 'h' }
      );
      expect(config.enabled).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Public IP could not be detected'));
      const genArgs = run.mock.calls.find(([, args]) => args.includes('-keyout'))[1];
      const opensslConfig = readFileSync(genArgs[genArgs.indexOf('-config') + 1], 'utf-8');
      expect(opensslConfig).not.toContain('999.999.999.999');
      expect(opensslConfig).toContain('IP.1 = 127.0.0.1');
      expect(opensslConfig).toContain('IP.2 = ::1');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

const ENTRY_POINT = fileURLToPath(new URL('./index.js', import.meta.url));

/**
 * Startup side-effect regression (Finding 2): invalid TLS material must fail
 * before initDatabase, session recovery, or workers run. These tests launch
 * the real entry point in a child process with an isolated DB path and
 * assert on the exit code, the diagnostics, and the absence of durable side
 * effects — not on source order.
 */
describe.skipIf(!hasOpenssl)('TLS startup side effects', () => {
  function runEntrySync(args, dbPath, extraEnv = {}) {
    return spawnSync(process.execPath, [ENTRY_POINT, ...args], {
      env: { ...process.env, DB_PATH: dbPath, ...extraEnv },
      encoding: 'utf-8',
      timeout: 60000,
    });
  }

  /** Start the server, wait for a banner line, then shut it down gracefully. */
  function runEntryUntilBanner(args, dbPath, banner, extraEnv = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [ENTRY_POINT, ...args], {
        env: { ...process.env, DB_PATH: dbPath, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`timed out waiting for banner ${banner}; stdout=${stdout} stderr=${stderr}`));
      }, 60000);
      timer.unref?.();
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.includes(banner)) {
          clearTimeout(timer);
          child.kill('SIGTERM');
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, stdout, stderr });
      });
    });
  }

  it('invalid custom material exits non-zero with resolved paths and no DB side effects', () => {
    const a = makeRealPair();
    const b = makeRealPair();
    const dir = mkdtempSync(join(tmpdir(), 'tls-startup-invalid-'));
    const dbPath = join(dir, 'test.db');
    // Markers pass the old substring check, but the key belongs to another cert.
    const result = runEntrySync(
      ['--port', '48991', '--ssl-cert', a.certPath, '--ssl-key', b.keyPath],
      dbPath
    );
    expect(result.status).not.toBe(0);
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    expect(output).toContain(a.certPath);
    expect(output).toContain(b.keyPath);
    expect(output).not.toContain('Database initialized');
    expect(existsSync(dbPath)).toBe(false);
  });

  it('invalid persisted self-signed material exits non-zero without touching the DB', () => {
    const a = makeRealPair();
    const b = makeRealPair();
    const dir = mkdtempSync(join(tmpdir(), 'tls-startup-reuse-'));
    const tlsDir = join(dir, 'tls');
    const dbPath = join(dir, 'test.db');
    mkdirSync(tlsDir, { recursive: true });
    writeFileSync(join(tlsDir, 'cert.pem'), readFileSync(a.certPath, 'utf-8'));
    writeFileSync(join(tlsDir, 'key.pem'), readFileSync(b.keyPath, 'utf-8'));
    const result = runEntrySync(['--port', '48992', '--self-signed', '--tls-dir', tlsDir], dbPath);
    expect(result.status).not.toBe(0);
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    expect(output).toContain(join(tlsDir, 'cert.pem'));
    expect(output).toContain(join(tlsDir, 'key.pem'));
    expect(output).not.toContain('Database initialized');
    expect(existsSync(dbPath)).toBe(false);
  });

  it('leaves a seeded database file byte-identical on TLS failure', () => {
    const a = makeRealPair();
    const b = makeRealPair();
    const dir = mkdtempSync(join(tmpdir(), 'tls-startup-seeded-'));
    const dbPath = join(dir, 'test.db');
    const sentinel = 'seeded-sentinel-bytes';
    writeFileSync(dbPath, sentinel);
    const result = runEntrySync(
      ['--port', '48993', '--ssl-cert', a.certPath, '--ssl-key', b.keyPath],
      dbPath
    );
    expect(result.status).not.toBe(0);
    expect(readFileSync(dbPath, 'utf-8')).toBe(sentinel);
  });

  it('plain HTTP startup still initializes the DB and serves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tls-startup-http-'));
    const dbPath = join(dir, 'test.db');
    const result = await runEntryUntilBanner(
      ['--port', '48994'],
      dbPath,
      'Circus Chief running on http://'
    );
    expect(result.stdout).toContain('Database initialized');
    expect(result.stdout).toContain('Circus Chief running on http://');
    expect(existsSync(dbPath)).toBe(true);
  }, 90000);

  it('valid custom TLS startup serves HTTPS', async () => {
    const pair = makeRealPair();
    const dir = mkdtempSync(join(tmpdir(), 'tls-startup-valid-'));
    const dbPath = join(dir, 'test.db');
    const result = await runEntryUntilBanner(
      ['--port', '48995', '--ssl-cert', pair.certPath, '--ssl-key', pair.keyPath],
      dbPath,
      'Circus Chief running on https://'
    );
    expect(result.stdout).toContain('Database initialized');
    expect(existsSync(dbPath)).toBe(true);
  }, 90000);
});
