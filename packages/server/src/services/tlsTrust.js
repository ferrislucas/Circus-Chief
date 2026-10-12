import { getApiBaseUrl } from './apiBaseUrl.js';

/**
 * POSIX-shell quote a single argument: wrap in single quotes, escaping
 * embedded single quotes as '\''. Safe for spaces, apostrophes, `$`, and
 * backticks in certificate paths.
 *
 * @param {string} value - Raw argument value.
 * @returns {string} Shell-quoted argument.
 */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/**
 * Whether generated agent API commands must explicitly trust the local
 * self-signed certificate. True only when the server itself serves HTTPS
 * from a self-signed pair (CIRCUSCHIEF_CA_CERT published at startup) AND
 * the advertised API URL is the local server (no CIRCUSCHIEF_API_URL
 * override pointing at an unrelated endpoint).
 *
 * A custom CA-trusted certificate needs no extra trust configuration, and
 * an override URL belongs to another endpoint whose trust is the
 * operator's concern — never attach the local cert there.
 *
 * @returns {boolean}
 */
export function needsSelfSignedTrust() {
  if (process.env.CIRCUSCHIEF_SECURE !== '1') return false;
  if (!process.env.CIRCUSCHIEF_CA_CERT) return false;
  if (process.env.CIRCUSCHIEF_API_URL) return false;
  return getApiBaseUrl().startsWith('https://');
}

/**
 * The curl command prefix for generated agent API commands. In self-signed
 * mode this pins trust to the server certificate via --cacert (verification
 * stays enabled); otherwise it is plain `curl`.
 *
 * @returns {string} e.g. `curl` or `curl --cacert '/path/to/cert.pem'`
 */
export function getApiCurlCommand() {
  if (!needsSelfSignedTrust()) return 'curl';
  return `curl --cacert ${shellQuote(process.env.CIRCUSCHIEF_CA_CERT)}`;
}

/**
 * Trust documentation for non-curl HTTP clients, shown only in self-signed
 * mode. Never includes key material — only the public certificate path.
 *
 * @returns {string} Markdown section, or '' when trust is not applicable.
 */
export function buildTlsTrustDocs() {
  if (!needsSelfSignedTrust()) return '';
  const certPath = process.env.CIRCUSCHIEF_CA_CERT;
  const quoted = shellQuote(certPath);
  return `## TLS Trust (Self-Signed Certificate)

This server uses a self-signed certificate. Verification stays enabled everywhere — trust this exact certificate instead of disabling verification (never use \`curl --insecure\`/\`-k\`, \`NODE_TLS_REJECT_UNAUTHORIZED=0\`, or Python \`verify=False\`).

- API base URL: ${getApiBaseUrl()}
- Server certificate (public, safe to read): ${certPath}

\`\`\`bash
# curl (as generated in the examples below)
curl --cacert ${quoted} ${getApiBaseUrl()}/api/projects
\`\`\`

Other clients:

\`\`\`bash
# Node.js (applies to the agent process and its children)
export NODE_EXTRA_CA_CERTS=${quoted}
node app.js
\`\`\`

\`\`\`python
# Python (requests / httpx verify against this CA bundle)
import requests
requests.get(f"${getApiBaseUrl()}/api/projects", verify=${JSON.stringify(certPath)})
\`\`\`

Hostname verification still applies: connect through the advertised base URL host (covered by the certificate SANs), not a different name or IP. The certificate file must be readable by the agent user.`;
}
