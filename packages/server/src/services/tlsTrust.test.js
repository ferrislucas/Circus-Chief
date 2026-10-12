import { describe, it, expect, afterEach } from 'vitest';
import {
  shellQuote,
  needsSelfSignedTrust,
  getApiCurlCommand,
  buildTlsTrustDocs,
} from './tlsTrust.js';

describe('shellQuote', () => {
  it('wraps a plain path in single quotes', () => {
    expect(shellQuote('/home/user/.circuschief/tls/cert.pem')).toBe(
      "'/home/user/.circuschief/tls/cert.pem'"
    );
  });

  it.each([
    ['/tmp/a b/cert.pem', "'/tmp/a b/cert.pem'"],
    ["/tmp/a'b/cert.pem", `'/tmp/a'\\''b/cert.pem'`],
    ['/tmp/a$b/cert.pem', "'/tmp/a$b/cert.pem'"],
    ['/tmp/a`b`/cert.pem', "'/tmp/a`b`/cert.pem'"],
    ['/tmp/a"b/cert.pem', "'/tmp/a\"b/cert.pem'"],
  ])('quotes %p as %p', (input, expected) => {
    expect(shellQuote(input)).toBe(expected);
  });
});

describe('self-signed curl trust', () => {
  afterEach(() => {
    delete process.env.CIRCUSCHIEF_API_URL;
    delete process.env.CIRCUSCHIEF_CA_CERT;
    delete process.env.CIRCUSCHIEF_SECURE;
    delete process.env.CIRCUSCHIEF_HOST;
    delete process.env.PORT;
  });

  function selfSignedEnv(certPath = '/srv/tls/cert.pem') {
    delete process.env.CIRCUSCHIEF_API_URL;
    process.env.CIRCUSCHIEF_SECURE = '1';
    process.env.CIRCUSCHIEF_CA_CERT = certPath;
    process.env.PORT = '5000';
  }

  it('uses plain curl over HTTP', () => {
    delete process.env.CIRCUSCHIEF_API_URL;
    delete process.env.CIRCUSCHIEF_SECURE;
    delete process.env.CIRCUSCHIEF_CA_CERT;
    expect(needsSelfSignedTrust()).toBe(false);
    expect(getApiCurlCommand()).toBe('curl');
    expect(buildTlsTrustDocs()).toBe('');
  });

  it('uses plain curl for ordinarily trusted custom TLS (no CA cert published)', () => {
    delete process.env.CIRCUSCHIEF_API_URL;
    process.env.CIRCUSCHIEF_SECURE = '1';
    delete process.env.CIRCUSCHIEF_CA_CERT;
    expect(needsSelfSignedTrust()).toBe(false);
    expect(getApiCurlCommand()).toBe('curl');
    expect(buildTlsTrustDocs()).toBe('');
  });

  it('pins --cacert in self-signed mode', () => {
    selfSignedEnv();
    expect(needsSelfSignedTrust()).toBe(true);
    expect(getApiCurlCommand()).toBe("curl --cacert '/srv/tls/cert.pem'");
  });

  it('shell-quotes hostile cert paths', () => {
    selfSignedEnv("/tmp/a b'o$d`e/cert.pem");
    expect(getApiCurlCommand()).toBe(`curl --cacert ${shellQuote("/tmp/a b'o$d`e/cert.pem")}`);
    expect(getApiCurlCommand()).toContain("'\\''");
    expect(getApiCurlCommand()).not.toContain('--insecure');
  });

  it('never attaches the local cert to an override endpoint', () => {
    selfSignedEnv();
    process.env.CIRCUSCHIEF_API_URL = 'https://unrelated.example.com:5443';
    expect(needsSelfSignedTrust()).toBe(false);
    expect(getApiCurlCommand()).toBe('curl');
    expect(buildTlsTrustDocs()).toBe('');
  });

  it('documents other clients with the cert path and hostname expectations', () => {
    selfSignedEnv('/srv/tls/cert.pem');
    const docs = buildTlsTrustDocs();
    expect(docs).toContain('/srv/tls/cert.pem');
    expect(docs).toContain('NODE_EXTRA_CA_CERTS');
    expect(docs).toContain('verify');
    expect(docs).toContain('Hostname verification');
    expect(docs).not.toMatch(/BEGIN (CERTIFICATE|PRIVATE KEY)/);
    // Forbidden flags are named only inside an explicit never-use prohibition.
    expect(docs).toContain('never use');
    expect(docs).toContain('--insecure');
    expect(docs).toContain('NODE_TLS_REJECT_UNAUTHORIZED=0');
    expect(docs).toContain('verify=False');
  });
});
