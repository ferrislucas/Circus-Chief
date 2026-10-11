import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync, existsSync, readdirSync, rmSync } from 'fs';
import { execFileSync, spawn, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
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
    // The openssl config lives in a private staging directory that is cleaned
    // up after publication, so snapshot it while the stub runs.
    let opensslConfig = '';
    const run = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      const keyOut = args[args.indexOf('-keyout') + 1];
      const certOut = args[args.indexOf('-out') + 1];
      writeFileSync(keyOut, stubKey);
      writeFileSync(certOut, stubCert);
      opensslConfig = readFileSync(args[args.indexOf('-config') + 1], 'utf-8');
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
    // Snapshot the staging config while the stub runs: staging is cleaned up
    // after publication.
    let opensslConfig = '';
    const run = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      writeFileSync(args[args.indexOf('-keyout') + 1], stubKey);
      writeFileSync(args[args.indexOf('-out') + 1], stubCert);
      opensslConfig = readFileSync(args[args.indexOf('-config') + 1], 'utf-8');
      return Buffer.from('');
    });
    try {
      const config = await resolveTlsConfig(
        { selfSigned: true, tlsDir: dir },
        { run, detectPublicIp: async () => '999.999.999.999', interfaces: {}, host: 'h' }
      );
      expect(config.enabled).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Public IP could not be detected'));
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

/**
 * Finding #3 (P2): shared self-signed generation must be coordinated across
 * processes and published without exposing mixed material. These regressions
 * fail on an implementation that checks-then-generates directly against the
 * final cert/key paths with no inter-process coordination.
 */
describe.skipIf(!hasOpenssl)('self-signed shared generation coordination (finding #3)', () => {
  /** Stub openssl that emits a distinct real pair per generation call. */
  function makeDistinctStub() {
    const first = makeRealPair();
    const second = makeRealPair();
    const firstKey = readFileSync(first.keyPath, 'utf-8');
    const firstCert = readFileSync(first.certPath, 'utf-8');
    const secondKey = readFileSync(second.keyPath, 'utf-8');
    const secondCert = readFileSync(second.certPath, 'utf-8');
    let generations = 0;
    const run = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      generations += 1;
      const material = generations === 1
        ? { key: firstKey, cert: firstCert }
        : { key: secondKey, cert: secondCert };
      writeFileSync(args[args.indexOf('-keyout') + 1], material.key);
      writeFileSync(args[args.indexOf('-out') + 1], material.cert);
      return Buffer.from('');
    });
    return { run, get generations() { return generations; } };
  }

  it('overlapping first starts generate once and agree on the persisted identity', async () => {
    const dir = join(tmpdir(), `tls-race-${Date.now()}-${process.pid}`);
    const stub = makeDistinctStub();
    // Deterministic overlap: both calls block in public-IP discovery until
    // both have passed the initial existence check, then proceed together.
    let releaseDiscovery;
    const gate = new Promise((resolveGate) => {
      releaseDiscovery = resolveGate;
    });
    const gatedDetectPublicIp = () => gate.then(() => null);
    const opts = { selfSigned: true, tlsDir: dir };
    const deps = () => ({ run: stub.run, detectPublicIp: gatedDetectPublicIp, interfaces: {}, host: 'racehost' });
    const first = resolveTlsConfig(opts, deps());
    const second = resolveTlsConfig(opts, deps());
    releaseDiscovery();
    const [c1, c2] = await Promise.all([first, second]);

    expect(stub.generations).toBe(1);
    expect(c1.cert).toBe(c2.cert);
    expect(c1.key).toBe(c2.key);
    expect(readFileSync(join(dir, 'cert.pem'), 'utf-8')).toBe(c1.cert);
    expect(readFileSync(join(dir, 'key.pem'), 'utf-8')).toBe(c1.key);
    expect(statSync(join(dir, 'key.pem')).mode & 0o777).toBe(0o600);
  });

  it('separate processes sharing one TLS directory converge on one valid identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tls-xproc-'));
    const tlsDir = join(root, 'tls');
    const goFile = join(root, 'go');
    const tlsModuleUrl = pathToFileURL(fileURLToPath(new URL('./tls.js', import.meta.url))).href;
    const childSource = `
      import { existsSync, writeFileSync } from 'fs';
      import { resolveTlsConfig } from ${JSON.stringify(tlsModuleUrl)};
      const [tlsDirArg, goFileArg, outFileArg, readyFileArg] = process.argv.slice(2);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      writeFileSync(readyFileArg, String(process.pid));
      for (let i = 0; i < 600 && !existsSync(goFileArg); i++) await sleep(50);
      if (!existsSync(goFileArg)) {
        writeFileSync(outFileArg, JSON.stringify({ ok: false, error: 'barrier timeout' }));
        process.exit(1);
      }
      try {
        const cfg = await resolveTlsConfig(
          { selfSigned: true, tlsDir: tlsDirArg },
          { detectPublicIp: async () => null, interfaces: {}, host: 'xprochost' }
        );
        writeFileSync(outFileArg, JSON.stringify({ ok: true, cert: cfg.cert, key: cfg.key }));
      } catch (err) {
        writeFileSync(outFileArg, JSON.stringify({ ok: false, error: String(err?.message || err) }));
        process.exit(1);
      }
    `;
    const children = [0, 1].map((i) => {
      const childPath = join(root, `child-${i}.mjs`);
      const outFile = join(root, `out-${i}.json`);
      const readyFile = join(root, `ready-${i}`);
      writeFileSync(childPath, childSource);
      const child = spawn(process.execPath, [childPath, tlsDir, goFile, outFile, readyFile], {
        stdio: 'ignore',
      });
      return { child, outFile, readyFile };
    });
    try {
      // Barrier: release both children only after both are waiting on it, so
      // their generations genuinely contend (an in-process mutex cannot help
      // here — these are separate processes).
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 600 && children.some((c) => !existsSync(c.readyFile)); i++) {
        await sleep(50);
      }
      expect(children.map((c) => existsSync(c.readyFile))).toEqual([true, true]);
      writeFileSync(goFile, 'go');
      await Promise.all(
        children.map(
          ({ child }) =>
            new Promise((resolveExit, rejectExit) => {
              const timer = setTimeout(() => rejectExit(new Error('child timeout')), 90000);
              timer.unref?.();
              child.on('exit', (code) => {
                clearTimeout(timer);
                resolveExit(code);
              });
              child.on('error', rejectExit);
            })
        )
      );
      const results = children.map(({ outFile }) => JSON.parse(readFileSync(outFile, 'utf-8')));
      expect(results.map((r) => r.ok)).toEqual([true, true]);
      expect(results[0].cert).toBe(results[1].cert);
      expect(results[0].key).toBe(results[1].key);
      // The converged identity is cryptographically valid and matches disk.
      const { createSecureContext } = await import('tls');
      expect(() => createSecureContext({ cert: results[0].cert, key: results[0].key })).not.toThrow();
      expect(readFileSync(join(tlsDir, 'cert.pem'), 'utf-8')).toBe(results[0].cert);
      expect(readFileSync(join(tlsDir, 'key.pem'), 'utf-8')).toBe(results[0].key);
    } finally {
      for (const { child } of children) child.kill('SIGKILL');
    }
  });

  it('generation failure leaves no partial final pair and releases coordination', async () => {
    const dir = join(tmpdir(), `tls-genfail-clean-${Date.now()}-${process.pid}`);
    const run = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      // Simulate an OpenSSL run that emits temporary output, then fails.
      writeFileSync(args[args.indexOf('-keyout') + 1], 'partial-key-bytes');
      writeFileSync(args[args.indexOf('-out') + 1], 'partial-cert-bytes');
      throw new Error('req failed');
    });
    await expect(
      resolveTlsConfig(
        { selfSigned: true, tlsDir: dir },
        { run, detectPublicIp: async () => null, interfaces: {}, host: 'h' }
      )
    ).rejects.toThrow(/generation failed/);

    // No new partial final pair may remain behind.
    expect(existsSync(join(dir, 'cert.pem'))).toBe(false);
    expect(existsSync(join(dir, 'key.pem'))).toBe(false);
    // Temporary artifacts and coordination are released.
    const leftovers = existsSync(dir) ? readdirSync(dir) : [];
    expect(leftovers.filter((name) => name.startsWith('.'))).toEqual([]);

    // A subsequent startup can generate successfully.
    const stub = makeRealPair();
    const goodRun = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      writeFileSync(args[args.indexOf('-keyout') + 1], readFileSync(stub.keyPath, 'utf-8'));
      writeFileSync(args[args.indexOf('-out') + 1], readFileSync(stub.certPath, 'utf-8'));
      return Buffer.from('');
    });
    const config = await resolveTlsConfig(
      { selfSigned: true, tlsDir: dir },
      { run: goodRun, detectPublicIp: async () => null, interfaces: {}, host: 'h' }
    );
    expect(config.enabled).toBe(true);
    expect(config.reused).toBe(false);
  });

  it('publication failure serves no mixed material and later startup recovers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tls-publish-fail-'));
    const tlsDir = join(dir, 'tls');
    const stub = makeRealPair();
    const stubKey = readFileSync(stub.keyPath, 'utf-8');
    const stubCert = readFileSync(stub.certPath, 'utf-8');
    const run = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      writeFileSync(args[args.indexOf('-keyout') + 1], stubKey);
      writeFileSync(args[args.indexOf('-out') + 1], stubCert);
      return Buffer.from('');
    });
    const enteredFile = join(dir, 'publish-entered');
    const gateFile = join(dir, 'publish-gate');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let publisherError = null;
    const publisher = resolveTlsConfig(
      { selfSigned: true, tlsDir },
      {
        run,
        detectPublicIp: async () => null,
        interfaces: {},
        host: 'h',
        afterFirstPublish: async () => {
          writeFileSync(enteredFile, 'entered');
          for (let i = 0; i < 1200 && !existsSync(gateFile); i++) await sleep(50);
          const decision = existsSync(gateFile) ? readFileSync(gateFile, 'utf-8') : 'proceed';
          if (decision === 'fail') throw new Error('injected publication failure');
        },
      }
    ).catch((err) => {
      publisherError = err;
      return null;
    });
    for (let i = 0; i < 600 && !existsSync(enteredFile); i++) await sleep(50);
    expect(existsSync(enteredFile)).toBe(true);

    // A reader arriving mid-publication must wait for publication to finish
    // rather than loading a half-published pair.
    let readerResolved = false;
    const reader = resolveTlsConfig(
      { selfSigned: true, tlsDir },
      { run, detectPublicIp: async () => null, interfaces: {}, host: 'h' }
    ).then((config) => {
      readerResolved = true;
      return config;
    });
    await sleep(500);
    expect(readerResolved).toBe(false);
    writeFileSync(gateFile, 'fail');

    await publisher;
    expect(publisherError).not.toBeNull();
    const readerConfig = await reader;
    // The failed publisher served no mixed material and the reader recovered
    // with a valid pair that matches the committed bytes on disk.
    const { createSecureContext } = await import('tls');
    expect(() =>
      createSecureContext({ cert: readerConfig.cert, key: readerConfig.key })
    ).not.toThrow();
    expect(readFileSync(join(tlsDir, 'cert.pem'), 'utf-8')).toBe(readerConfig.cert);
    expect(readFileSync(join(tlsDir, 'key.pem'), 'utf-8')).toBe(readerConfig.key);
  });

  it('a held lock surfaces a bounded actionable timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tls-lock-timeout-'));
    // Occupy the per-directory coordination with a live owner (this process)
    // using the documented layout: <tlsDir>/.lock/owner.json { pid, ... }.
    mkdirSync(join(dir, '.lock'));
    writeFileSync(
      join(dir, '.lock', 'owner.json'),
      JSON.stringify({ pid: process.pid, token: 'test-holder', createdAt: Date.now() })
    );
    const run = vi.fn();
    await expect(
      resolveTlsConfig(
        { selfSigned: true, tlsDir: dir },
        { run, lockTimeoutMs: 300, detectPublicIp: async () => null }
      )
    ).rejects.toThrow(/timed out waiting/i);
    await expect(
      resolveTlsConfig(
        { selfSigned: true, tlsDir: dir },
        { run, lockTimeoutMs: 300, detectPublicIp: async () => null }
      )
    ).rejects.toThrow(new RegExp(escapeRegExp(dir)));
    expect(run).not.toHaveBeenCalled();
    // Ordinary startup still works once the holder is gone.
    rmSync(join(dir, '.lock'), { recursive: true, force: true });
    const stub = makeRealPair();
    const goodRun = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      writeFileSync(args[args.indexOf('-keyout') + 1], readFileSync(stub.keyPath, 'utf-8'));
      writeFileSync(args[args.indexOf('-out') + 1], readFileSync(stub.certPath, 'utf-8'));
      return Buffer.from('');
    });
    const config = await resolveTlsConfig(
      { selfSigned: true, tlsDir: dir },
      { run: goodRun, detectPublicIp: async () => null, interfaces: {}, host: 'h' }
    );
    expect(config.enabled).toBe(true);
  });

  it('a healthy persisted identity is never rewritten', async () => {
    const seed = makeRealPair();
    const dir = mkdtempSync(join(tmpdir(), 'tls-healthy-'));
    const certBytes = readFileSync(seed.certPath, 'utf-8');
    const keyBytes = readFileSync(seed.keyPath, 'utf-8');
    writeFileSync(join(dir, 'cert.pem'), certBytes);
    writeFileSync(join(dir, 'key.pem'), keyBytes);
    const run = vi.fn(() => {
      throw new Error('openssl must not run when a healthy pair exists');
    });
    const config = await resolveTlsConfig(
      { selfSigned: true, tlsDir: dir },
      { run, detectPublicIp: async () => { throw new Error('must not run'); } }
    );
    expect(config).toMatchObject({ enabled: true, reused: true });
    expect(config.cert).toBe(certBytes);
    expect(config.key).toBe(keyBytes);
    expect(readFileSync(join(dir, 'cert.pem'), 'utf-8')).toBe(certBytes);
    expect(readFileSync(join(dir, 'key.pem'), 'utf-8')).toBe(keyBytes);
    expect(run).not.toHaveBeenCalled();
  });
});

/**
 * Serve a cert/key over TLS with openssl s_server on an ephemeral port and
 * wait until verified HTTPS answers. s_server is the listener because this
 * environment's curl build does not complete a handshake with a Node TLS
 * terminator, while it verifies against s_server normally.
 */
async function startOpensslHttpsListener(certPath, keyPath) {
  const { createServer: createTcpServer } = await import('net');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const probe = createTcpServer();
  await new Promise((resolveListen) => probe.listen(0, '127.0.0.1', resolveListen));
  const port = probe.address().port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  const listener = spawn(
    'openssl',
    ['s_server', '-accept', String(port), '-cert', certPath, '-key', keyPath, '-www'],
    { stdio: 'ignore' }
  );
  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) {
    const poll = spawnSync(
      'curl',
      ['--max-time', '2', '--cacert', certPath, `https://127.0.0.1:${port}/`],
      { encoding: 'utf-8' }
    );
    if (poll.status === 0) ready = true;
    else await sleep(100);
  }
  if (!ready) {
    listener.kill('SIGKILL');
    throw new Error(`openssl s_server on port ${port} never answered verified HTTPS`);
  }
  return { port, close: () => listener.kill('SIGKILL') };
}

/**
 * Finding #5 (P2): a relative --tls-dir override must still produce agent
 * trust material that resolves from any working directory.
 */
describe.skipIf(!hasOpenssl)('self-signed relative tlsDir (finding #5)', () => {
  const envKeys = ['CIRCUSCHIEF_SECURE', 'CIRCUSCHIEF_CA_CERT', 'CIRCUSCHIEF_API_URL', 'CIRCUSCHIEF_HOST', 'PORT'];
  let savedEnv;
  const saveEnv = () => {
    savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  };
  const restoreEnv = () => {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  };

  it('resolves relative tlsDir storage to absolute paths for generated and reused pairs', async () => {
    const relDir = `tls-rel-${Date.now()}-${process.pid}`;
    const absDir = join(process.cwd(), relDir);
    try {
      const generated = await resolveTlsConfig(
        { selfSigned: true, tlsDir: relDir },
        { detectPublicIp: async () => null, interfaces: {}, host: 'h' }
      );
      expect(isAbsolute(generated.certPath)).toBe(true);
      expect(isAbsolute(generated.keyPath)).toBe(true);
      expect(generated.certPath).toBe(join(absDir, 'cert.pem'));
      expect(generated.keyPath).toBe(join(absDir, 'key.pem'));

      const reused = await resolveTlsConfig(
        { selfSigned: true, tlsDir: relDir },
        { detectPublicIp: async () => null, interfaces: {}, host: 'h' }
      );
      expect(reused.reused).toBe(true);
      expect(reused.certPath).toBe(generated.certPath);
      expect(reused.keyPath).toBe(generated.keyPath);
      expect(reused.cert).toBe(generated.cert);
    } finally {
      rmSync(absDir, { recursive: true, force: true });
    }
  });

  it('agent curl trust verifies from a different working directory with a hostile storage name', async () => {
    saveEnv();
    const { getApiCurlCommand, buildTlsTrustDocs } = await import('./services/tlsTrust.js');
    // Relative storage with spaces and an apostrophe: exercises shell quoting
    // and proves the published trust path is absolute — a relative path
    // cannot be found from the agent's working directory.
    const relStorage = `tls agent's rel-${Date.now()}-${process.pid}`;
    const absStorage = join(process.cwd(), relStorage);
    try {
      const config = await resolveTlsConfig(
        { selfSigned: true, tlsDir: relStorage },
        { detectPublicIp: async () => null, interfaces: {}, host: 'localhost' }
      );
      expect(isAbsolute(config.certPath)).toBe(true);
      expect(config.certPath).toBe(join(absStorage, 'cert.pem'));

      // Temporary HTTPS listener serving the generated pair (localhost SAN).
      const { port, close } = await startOpensslHttpsListener(config.certPath, config.keyPath);
      try {
        delete process.env.CIRCUSCHIEF_API_URL;
        delete process.env.CIRCUSCHIEF_HOST;
        process.env.CIRCUSCHIEF_SECURE = '1';
        process.env.CIRCUSCHIEF_CA_CERT = config.certPath;
        process.env.PORT = String(port);
        const curlCommand = getApiCurlCommand();
        expect(curlCommand).toContain('--cacert');
        expect(curlCommand).not.toContain('--insecure');
        // Execute the exact generated command from another directory: with an
        // absolute --cacert path this verifies; with a relative path curl
        // exits 77 (missing CA file) and execFileSync throws.
        const agentCwd = mkdtempSync(join(tmpdir(), 'tls-agent-cwd-'));
        const body = execFileSync(
          'sh',
          ['-c', `${curlCommand} 'https://localhost:${port}/api/projects'`],
          { cwd: agentCwd, encoding: 'utf-8', timeout: 30000 }
        );
        expect(body).toContain('s_server');
        // Other-client trust examples reference the same absolute path.
        const docs = buildTlsTrustDocs();
        expect(docs).toContain(config.certPath);
      } finally {
        close();
      }
    } finally {
      rmSync(absStorage, { recursive: true, force: true });
      restoreEnv();
    }
  });
});
