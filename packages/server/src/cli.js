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
  -H, --host <address> Network address to bind to (env: CIRCUSCHIEF_HOST or HOST, default: ${DEFAULT_SERVER_HOST})
  --no-analytics       Disable anonymous usage analytics
  -h, --help           Show this help message
  -V, --version        Show version number`);
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

export function parseCliOptions(argv = process.argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv.slice(2),
      strict: true,
      options: {
        port: {
          type: 'string',
          short: 'p',
          default: process.env.PORT || String(DEFAULT_SERVER_PORT),
        },
        host: {
          type: 'string',
          short: 'H',
          // Trim before the fallback chain so a whitespace-only env var falls
          // through to the default instead of failing startup later. Bare
          // HOST is a legacy fallback: some shells and CI images export it
          // with the machine hostname, so prefer CIRCUSCHIEF_HOST.
          default:
            process.env.CIRCUSCHIEF_HOST?.trim() ||
            process.env.HOST?.trim() ||
            DEFAULT_SERVER_HOST,
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

  return { port, host, disableAnalytics: values['no-analytics'] };
}
