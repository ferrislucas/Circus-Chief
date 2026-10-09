import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, statSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  TlsError,
  buildSelfSignedSans,
  getLanIPv4s,
  getDefaultTlsDir,
  resolveTlsConfig,
} from './tls.js';

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

  it('loads a custom PEM pair', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tls-custom-'));
    const certPath = join(dir, 'cert.pem');
    const keyPath = join(dir, 'key.pem');
    writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n');
    writeFileSync(keyPath, '-----BEGIN PRIVATE KEY-----\nxyz\n-----END PRIVATE KEY-----\n');

    const config = await resolveTlsConfig({ sslCert: certPath, sslKey: keyPath });
    expect(config.enabled).toBe(true);
    expect(config.source).toBe('custom');
    expect(config.cert).toContain('BEGIN CERTIFICATE');
    expect(config.key).toContain('PRIVATE KEY');
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

  it('reuses an existing self-signed pair without invoking openssl', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tls-reuse-'));
    writeFileSync(join(dir, 'cert.pem'), 'CERT-BODY');
    writeFileSync(join(dir, 'key.pem'), 'KEY-BODY');
    const run = vi.fn();

    const config = await resolveTlsConfig({ selfSigned: true, tlsDir: dir }, { run });
    expect(config).toMatchObject({ enabled: true, source: 'self-signed', reused: true });
    expect(config.cert).toBe('CERT-BODY');
    expect(run).not.toHaveBeenCalled();
  });

  it('generates a self-signed pair via openssl and sets key mode 0600', async () => {
    const dir = join(tmpdir(), `tls-gen-${Date.now()}`);
    const run = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      const keyOut = args[args.indexOf('-keyout') + 1];
      const certOut = args[args.indexOf('-out') + 1];
      writeFileSync(keyOut, 'KEY');
      writeFileSync(certOut, 'CERT');
      return Buffer.from('');
    });

    const config = await resolveTlsConfig(
      { selfSigned: true, tlsDir: dir },
      { run, detectPublicIp: async () => '203.0.113.7', interfaces: {}, host: 'testhost' }
    );
    expect(config).toMatchObject({ enabled: true, source: 'self-signed', reused: false });
    expect(readFileSync(join(dir, 'cert.pem'), 'utf-8')).toBe('CERT');
    expect(statSync(join(dir, 'key.pem')).mode & 0o777).toBe(0o600);
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

  it('warns and continues when public-IP detection fails', async () => {
    const dir = join(tmpdir(), `tls-offline-${Date.now()}`);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = vi.fn((cmd, args) => {
      if (args.includes('version')) return Buffer.from('OpenSSL 3');
      writeFileSync(args[args.indexOf('-keyout') + 1], 'KEY');
      writeFileSync(args[args.indexOf('-out') + 1], 'CERT');
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
