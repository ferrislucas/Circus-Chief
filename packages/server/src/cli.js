import { parseArgs } from 'node:util';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DEFAULT_SERVER_PORT, DEFAULT_SERVER_HOST } from '@circuschief/shared';
import { describeBindHost } from './bindAddress.js';

export { describeBindHost };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function showHelp() {
  console.log(`Usage: circuschief [options]

Options:
  -p, --port <number>  Port to listen on (env: PORT, default: ${DEFAULT_SERVER_PORT})
  -H, --host <address> Network address to bind to (default: ${DEFAULT_SERVER_HOST})
  --no-analytics       Disable anonymous usage analytics
  --ssl-cert <path>    Path to a PEM certificate file (must pair with --ssl-key)
  --ssl-key <path>     Path to a PEM private key file (must pair with --ssl-cert)
  --self-signed        Generate (or reuse) a self-signed cert for HTTPS (needs openssl)
  --tls-dir <path>     Storage dir for the self-signed cert pair (default: ~/.circuschief/tls/)
  -h, --help           Show this help message
  -V, --version        Show version number

TLS examples:
  circuschief --ssl-cert ./cert.pem --ssl-key ./key.pem
  circuschief --self-signed`);
}

function getVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../package.json'), 'utf-8')
    );
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

const CLI_OPTIONS = {
  port: {
    type: 'string',
    short: 'p',
    // No static default: parseCliOptions overrides this entry per call so
    // the PORT env var is read lazily (tests set/unset it per case).
  },
  host: {
    type: 'string',
    short: 'H',
    // No environment variable fallback: the bind address comes only
    // from --host or the loopback default, so ambient HOST values
    // exported by shells or CI images can never move the server.
    default: DEFAULT_SERVER_HOST,
  },
  help: {
    type: 'boolean',
    short: 'h',
    default: false,
  },
  version: {
    type: 'boolean',
    short: 'V',
    default: false,
  },
  'no-analytics': {
    type: 'boolean',
    default: false,
  },
  'ssl-cert': {
    type: 'string',
  },
  'ssl-key': {
    type: 'string',
  },
  'self-signed': {
    type: 'boolean',
    default: false,
  },
  'tls-dir': {
    type: 'string',
  },
};

export function parseCliOptions(argv = process.argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv.slice(2),
      strict: true,
      options: {
        ...CLI_OPTIONS,
        port: { ...CLI_OPTIONS.port, default: process.env.PORT || String(DEFAULT_SERVER_PORT) },
      },
    }));
  } catch (err) {
    console.error(err.message);
    showHelp();
    process.exit(1);
  }

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  if (values.version) {
    console.log(getVersion());
    process.exit(0);
  }

  const port = parseInt(values.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Error: Invalid port "${values.port}". Must be 1-65535.`);
    process.exit(1);
  }

  const host = values.host.trim();
  if (host === '') {
    console.error(`Error: Invalid host "${values.host}". Must be a non-empty address.`);
    process.exit(1);
  }

  return { port, host, disableAnalytics: values['no-analytics'], ...parseTlsFlags(values) };
}

function parseTlsFlags(values) {
  const tls = {
    sslCert: values['ssl-cert'] ?? null,
    sslKey: values['ssl-key'] ?? null,
    selfSigned: values['self-signed'] ?? false,
    tlsDir: values['tls-dir'] ?? null,
  };

  if (tls.selfSigned && (tls.sslCert || tls.sslKey)) {
    console.error('Error: --self-signed cannot be combined with --ssl-cert or --ssl-key. Pick one TLS mode.');
    process.exit(1);
  }

  if ((tls.sslCert && !tls.sslKey) || (!tls.sslCert && tls.sslKey)) {
    console.error('Error: --ssl-cert and --ssl-key must be supplied together (both or neither).');
    process.exit(1);
  }

  return tls;
}
