import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { get } from 'https';
import { tmpdir, homedir, hostname, networkInterfaces } from 'os';
import { join, resolve } from 'path';

export const TLS_CERT_FILENAME = 'cert.pem';
export const TLS_KEY_FILENAME = 'key.pem';
export const SELF_SIGNED_VALIDITY_DAYS = 825;

export function getDefaultTlsDir() {
  return join(homedir(), '.circuschief', 'tls');
}

export class TlsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TlsError';
  }
}

/**
 * Non-internal IPv4 addresses from local interfaces (LAN + any directly
 * assigned public address). Never throws: an offline or unusual machine gets
 * loopback-only SANs and the caller warns.
 */
export function getLanIPv4s(interfaces = networkInterfaces()) {
  const ips = [];
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }
  return [...new Set(ips)];
}

/**
 * Best-effort public-IP discovery via api.ipify.org. Resolves to null on any
 * failure (offline machine, DNS blocked, slow link) so boot never fails here.
 */
export function detectPublicIp({ timeoutMs = 3000 } = {}) {
  return new Promise((resolvePromise) => {
    const req = get('https://api.ipify.org', { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        const ip = body.trim();
        resolvePromise(/^[0-9a-fA-F:.]+$/.test(ip) && ip.length > 0 ? ip : null);
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolvePromise(null);
    });
    req.on('error', () => resolvePromise(null));
  });
}

/**
 * Build the openssl subjectAltName entries for a self-signed cert.
 * Loopback entries always come first; LAN, hostname, and public IP follow.
 */
export function buildSelfSignedSans({ lanIps = [], host = '', publicIp = null } = {}) {
  const dns = ['localhost'];
  if (host && host !== 'localhost') dns.push(host);
  const ips = ['127.0.0.1', '::1'];
  for (const ip of lanIps) {
    if (!ips.includes(ip)) ips.push(ip);
  }
  if (publicIp && !ips.includes(publicIp)) ips.push(publicIp);
  return { dns, ips };
}

function writeOpensslConfig(configPath, sans) {
  const altLines = [
    ...sans.dns.map((name, i) => `DNS.${i + 1} = ${name}`),
    ...sans.ips.map((ip, i) => `IP.${i + 1} = ${ip}`),
  ];
  writeFileSync(
    configPath,
    `[req]
distinguished_name = dn
req_extensions = ext
prompt = no
[dn]
CN = localhost
[ext]
subjectAltName = @alt
[alt]
${altLines.join('\n')}
`
  );
}

function ensureOpensslAvailable(run = execFileSync) {
  try {
    run('openssl', ['version'], { stdio: 'ignore' });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new TlsError(
        'openssl is required for --self-signed but was not found. Install openssl and retry, or supply --ssl-cert/--ssl-key instead.'
      );
    }
    throw new TlsError(`openssl check failed: ${err?.message || err}`);
  }
}

function readPair(certPath, keyPath) {
  return { cert: readFileSync(certPath, 'utf-8'), key: readFileSync(keyPath, 'utf-8') };
}

/**
 * Resolve TLS configuration from CLI options.
 *
 * @param {object} options
 * @param {string|null} options.sslCert - PEM cert path (custom mode).
 * @param {string|null} options.sslKey - PEM key path (custom mode).
 * @param {boolean} options.selfSigned - Self-signed mode.
 * @param {string|null} options.tlsDir - Self-signed storage override.
 * @param {object} [deps] - Test seams: { run, detectPublicIp, interfaces, host }.
 * @returns {Promise<{enabled:false}|{enabled:true,key,cert,source,reused,certPath?,keyPath?}>}
 * @throws {TlsError} On any misconfiguration (caller exits non-zero pre-bind).
 */
export async function resolveTlsConfig(
  { sslCert = null, sslKey = null, selfSigned = false, tlsDir = null } = {},
  deps = {}
) {
  assertTlsModeValid({ sslCert, sslKey, selfSigned });
  if (sslCert && sslKey) return loadCustomPair(sslCert, sslKey);
  if (!selfSigned) return { enabled: false };
  return loadOrGenerateSelfSignedPair(tlsDir || getDefaultTlsDir(), deps);
}

function assertTlsModeValid({ sslCert, sslKey, selfSigned }) {
  if (selfSigned && (sslCert || sslKey)) {
    throw new TlsError('--self-signed cannot be combined with --ssl-cert or --ssl-key. Pick one TLS mode.');
  }
  if ((sslCert && !sslKey) || (!sslCert && sslKey)) {
    throw new TlsError('--ssl-cert and --ssl-key must be supplied together (both or neither).');
  }
}

function loadCustomPair(sslCert, sslKey) {
  const certPath = resolve(sslCert);
  const keyPath = resolve(sslKey);
  let pair;
  try {
    pair = readPair(certPath, keyPath);
  } catch (err) {
    throw new TlsError(`Failed to read TLS files (cert: ${certPath}, key: ${keyPath}): ${err.message}`);
  }
  if (!pair.cert.includes('BEGIN CERTIFICATE') || !pair.key.includes('PRIVATE KEY')) {
    throw new TlsError(`TLS files do not look like PEM (cert: ${certPath}, key: ${keyPath}).`);
  }
  return { enabled: true, key: pair.key, cert: pair.cert, source: 'custom', reused: false, certPath, keyPath };
}

async function loadOrGenerateSelfSignedPair(dir, deps = {}) {
  const certPath = join(dir, TLS_CERT_FILENAME);
  const keyPath = join(dir, TLS_KEY_FILENAME);

  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const pair = readPair(certPath, keyPath);
      return { enabled: true, key: pair.key, cert: pair.cert, source: 'self-signed', reused: true, certPath, keyPath };
    } catch (err) {
      throw new TlsError(`Failed to read existing self-signed pair (cert: ${certPath}, key: ${keyPath}): ${err.message}`);
    }
  }

  return generateSelfSignedPair(dir, certPath, keyPath, deps);
}

async function generateSelfSignedPair(dir, certPath, keyPath, deps = {}) {
  const run = deps.run || execFileSync;
  ensureOpensslAvailable(run);
  const publicIp = await detectPublicIpSafe(deps.detectPublicIp || detectPublicIp);
  const sans = buildSelfSignedSans({
    lanIps: getLanIPv4s(deps.interfaces),
    host: deps.host !== undefined ? deps.host : hostname(),
    publicIp,
  });

  mkdirSync(dir, { recursive: true });
  const configPath = join(mkdtempSync(join(tmpdir(), 'circuschief-tls-')), 'openssl.cnf');
  writeOpensslConfig(configPath, sans);
  try {
    run(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-days', String(SELF_SIGNED_VALIDITY_DAYS),
        '-keyout', keyPath,
        '-out', certPath,
        '-config', configPath,
        // -x509 self-signing reads x509 extensions only from the section
        // named here; req_extensions alone would leave the cert SAN-less.
        '-extensions', 'ext',
      ],
      { stdio: 'ignore' }
    );
  } catch (err) {
    throw new TlsError(`Self-signed certificate generation failed: ${err?.message || err}`);
  }
  chmodSync(keyPath, 0o600);

  const pair = readPair(certPath, keyPath);
  return { enabled: true, key: pair.key, cert: pair.cert, source: 'self-signed', reused: false, certPath, keyPath };
}

async function detectPublicIpSafe(detect) {
  try {
    const publicIp = await detect();
    if (!publicIp) {
      console.warn('[TLS] Public IP could not be detected (offline?); continuing with loopback + LAN SANs only.');
    }
    return publicIp;
  } catch {
    console.warn('[TLS] Public IP could not be detected (offline?); continuing with loopback + LAN SANs only.');
    return null;
  }
}
