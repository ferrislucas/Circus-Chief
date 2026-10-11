import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { get as httpsGet } from 'https';
import { createSecureContext } from 'tls';
import { isIP } from 'net';
import { homedir, hostname, networkInterfaces } from 'os';
import { join, resolve } from 'path';
import { acquireTlsLock, releaseTlsLock, removeQuietly } from './tlsLock.js';

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
export function detectPublicIp({ timeoutMs = 3000, get = httpsGet } = {}) {
  return new Promise((resolvePromise) => {
    const req = get('https://api.ipify.org', { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        const okStatus = (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300;
        const ip = body.trim();
        resolvePromise(okStatus && isIP(ip) !== 0 ? ip : null);
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
 * @param {object} [deps] - Test seams: { run, detectPublicIp, interfaces, host, lockTimeoutMs, afterFirstPublish }.
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

/**
 * Cryptographically validate a loaded cert/key pair (parseable material,
 * matching key, usable without a passphrase). Throws a TlsError naming the
 * resolved paths but never the key contents.
 */
function assertPairValid(pair, certPath, keyPath) {
  try {
    createSecureContext({ cert: pair.cert, key: pair.key });
  } catch (err) {
    throw new TlsError(
      `TLS certificate and key failed validation (cert: ${certPath}, key: ${keyPath}): ${err?.message || err}`
    );
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
  assertPairValid(pair, certPath, keyPath);
  return { enabled: true, key: pair.key, cert: pair.cert, source: 'custom', reused: false, certPath, keyPath };
}

// Crashed generations can leave staging directories behind; entries older
// than this are swept on lock acquisition (a live generation takes seconds).
const TLS_STALE_STAGING_MS = 60 * 60 * 1000;

/** Best-effort sweep of staging directories left by crashed generations. */
function sweepStaleStaging(absDir) {
  let entries;
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith('.staging-')) continue;
    const stagingPath = join(absDir, name);
    try {
      if (Date.now() - statSync(stagingPath).mtimeMs > TLS_STALE_STAGING_MS) {
        removeQuietly(stagingPath);
      }
    } catch {
      // Vanished mid-sweep; ignore.
    }
  }
}

/**
 * Read the persisted pair when both files exist. A complete but invalid pair
 * keeps its explicit early error; an incomplete pair (exactly one file) is a
 * recoverable leftover of an interrupted publication and regenerates below.
 */
function readCompletePair(certPath, keyPath) {
  if (!existsSync(certPath) || !existsSync(keyPath)) return null;
  let pair;
  try {
    pair = readPair(certPath, keyPath);
  } catch (err) {
    throw new TlsError(`Failed to read existing self-signed pair (cert: ${certPath}, key: ${keyPath}): ${err.message}`);
  }
  assertPairValid(pair, certPath, keyPath);
  return pair;
}

async function loadOrGenerateSelfSignedPair(dir, deps = {}) {
  // Resolve once so the persisted pair, the lock, staging, and the published
  // trust path are all absolute and independent of the working directory.
  const absDir = resolve(dir);
  const certPath = join(absDir, TLS_CERT_FILENAME);
  const keyPath = join(absDir, TLS_KEY_FILENAME);

  mkdirSync(absDir, { recursive: true });
  // Coordinate before checking, and recheck under the lock: the winner
  // generates while losers wait, then reuse the committed identity.
  let lock;
  try {
    lock = await acquireTlsLock(absDir, { timeoutMs: deps.lockTimeoutMs });
  } catch (err) {
    if (err instanceof TlsError) throw err;
    throw new TlsError(`Failed to coordinate self-signed certificate generation in ${absDir}: ${err?.message || err}`);
  }
  try {
    sweepStaleStaging(absDir);
    const existing = readCompletePair(certPath, keyPath);
    if (existing) {
      return { enabled: true, key: existing.key, cert: existing.cert, source: 'self-signed', reused: true, certPath, keyPath };
    }
    const staged = await generateStagedPair(absDir, deps);
    try {
      await publishStagedPair(staged, certPath, keyPath, deps);
    } finally {
      removeQuietly(staged.stagingDir);
    }
    const pair = readPair(certPath, keyPath);
    assertPairValid(pair, certPath, keyPath);
    return { enabled: true, key: pair.key, cert: pair.cert, source: 'self-signed', reused: false, certPath, keyPath };
  } finally {
    releaseTlsLock(lock);
  }
}

async function generateStagedPair(absDir, deps = {}) {
  const run = deps.run || execFileSync;
  ensureOpensslAvailable(run);
  const publicIp = await detectPublicIpSafe(deps.detectPublicIp || detectPublicIp);
  const sans = buildSelfSignedSans({
    lanIps: getLanIPv4s(deps.interfaces),
    host: deps.host !== undefined ? deps.host : hostname(),
    publicIp,
  });

  // Generate on the same filesystem inside a private staging directory so a
  // failure or crash can never leave a partial final pair behind.
  const stagingDir = mkdtempSync(join(absDir, '.staging-'));
  chmodSync(stagingDir, 0o700);
  const configPath = join(stagingDir, 'openssl.cnf');
  const stagedCertPath = join(stagingDir, TLS_CERT_FILENAME);
  const stagedKeyPath = join(stagingDir, TLS_KEY_FILENAME);
  writeOpensslConfig(configPath, sans);
  try {
    run(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-days', String(SELF_SIGNED_VALIDITY_DAYS),
        '-keyout', stagedKeyPath,
        '-out', stagedCertPath,
        '-config', configPath,
        // -x509 self-signing reads x509 extensions only from the section
        // named here; req_extensions alone would leave the cert SAN-less.
        '-extensions', 'ext',
      ],
      { stdio: 'ignore' }
    );
  } catch (err) {
    removeQuietly(stagingDir);
    throw new TlsError(`Self-signed certificate generation failed: ${err?.message || err}`);
  }
  // Protect the key from creation onward; the staging directory is 0700 and
  // the final key is pinned 0600 again at publication.
  chmodSync(stagedKeyPath, 0o600);
  let staged;
  try {
    staged = readPair(stagedCertPath, stagedKeyPath);
    assertPairValid(staged, stagedCertPath, stagedKeyPath);
  } catch (err) {
    removeQuietly(stagingDir);
    if (err instanceof TlsError) throw err;
    throw new TlsError(`Self-signed certificate generation failed: ${err?.message || err}`);
  }
  return { stagingDir, stagedCertPath, stagedKeyPath };
}

/**
 * Enforce the publication recovery invariant (finding #7): publication may
 * only begin when no complete pair exists. The caller holds the directory
 * lock and `readCompletePair` already returned null, so any surviving final
 * file is an incomplete remnant of an interrupted earlier publication — a
 * crash before publication leaves an incomplete or empty final state, and a
 * crash between the renames below leaves only the new certificate. Clearing
 * the remnant first means the next start can only ever observe an incomplete
 * state (regenerated) or the new complete pair, never a new certificate
 * beside an unrelated old key. A complete pair here fails closed instead of
 * being overwritten, preserving deliberate rejection of externally supplied
 * invalid pairs. Clearing is checked: a remnant that cannot be removed aborts
 * publication with a path-specific TlsError rather than proceeding.
 */
export function clearIncompleteRemnants(certPath, keyPath) {
  if (existsSync(certPath) && existsSync(keyPath)) {
    throw new TlsError(
      `Refusing to publish over a complete TLS pair (cert: ${certPath}, key: ${keyPath}).`
    );
  }
  for (const remnantPath of [certPath, keyPath]) {
    if (!existsSync(remnantPath)) continue;
    try {
      rmSync(remnantPath, { recursive: true, force: true });
    } catch (err) {
      throw new TlsError(
        `Failed to clear interrupted TLS publication remnant (${remnantPath}): ${err?.message || err}`
      );
    }
    if (existsSync(remnantPath)) {
      throw new TlsError(`Failed to clear interrupted TLS publication remnant (${remnantPath}).`);
    }
  }
}

async function publishStagedPair(staged, certPath, keyPath, deps = {}) {
  // Publish while holding the directory lock. Two independent renames are not
  // an atomic pair transaction, so the protocol is recoverable instead: both
  // final paths are verified absent above (any incomplete remnant cleared),
  // the new certificate is renamed first, then the new key. A crash before
  // publication leaves an incomplete or empty final state; a crash between
  // the renames leaves only the new certificate, which the next start
  // regenerates. A complete pre-existing pair is never overwritten here, so
  // mixed material cannot become the committed state.
  clearIncompleteRemnants(certPath, keyPath);
  const published = [];
  try {
    renameSync(staged.stagedCertPath, certPath);
    published.push(certPath);
    await deps.afterFirstPublish?.();
    renameSync(staged.stagedKeyPath, keyPath);
    published.push(keyPath);
  } catch (err) {
    for (const publishedPath of published) removeQuietly(publishedPath);
    if (err instanceof TlsError) throw err;
    throw new TlsError(
      `Self-signed certificate publication failed (cert: ${certPath}, key: ${keyPath}): ${err?.message || err}`
    );
  }
  chmodSync(keyPath, 0o600);
  // The certificate is public trust material: agent processes spawned by the
  // server run as the same user but must be able to read it regardless of
  // the operator's umask, so pin it world-readable.
  chmodSync(certPath, 0o644);
}

async function detectPublicIpSafe(detect) {
  try {
    const publicIp = await detect();
    // The injected detector is trusted to return a validated IP, but a
    // custom seam (or a future discovery source) could hand back garbage
    // that would otherwise become a fatal OpenSSL SAN entry. Treat anything
    // that is not a valid IP as an unavailable optional lookup.
    if (!publicIp || isIP(String(publicIp).trim()) === 0) {
      console.warn('[TLS] Public IP could not be detected (offline?); continuing with loopback + LAN SANs only.');
      return null;
    }
    return String(publicIp).trim();
  } catch {
    console.warn('[TLS] Public IP could not be detected (offline?); continuing with loopback + LAN SANs only.');
    return null;
  }
}
