import { parseArgs } from 'node:util';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DEFAULT_SERVER_PORT } from '@circuschief/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function showHelp() {
  console.log(`Usage: circuschief [options]

Options:
  -p, --port <number>  Port to listen on (env: PORT, default: ${DEFAULT_SERVER_PORT})
  --auth <user:pass>   Enable HTTP Basic Auth (env: CC_AUTH)
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
        auth: {
          type: 'string',
          default: process.env.CC_AUTH || '',
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

  // Parse auth credentials if provided
  let auth = null;
  const authValue = values.auth;
  if (authValue) {
    const colonIndex = authValue.indexOf(':');
    if (colonIndex === -1) {
      console.error('Error: --auth format must be <user:pass>');
      process.exit(1);
    }
    const username = authValue.slice(0, colonIndex);
    const password = authValue.slice(colonIndex + 1);
    if (!username) {
      console.error('Error: --auth username must not be empty');
      process.exit(1);
    }
    if (!password) {
      console.error('Error: --auth password must not be empty');
      process.exit(1);
    }
    auth = { username, password };
  }

  return { port, disableAnalytics: values['no-analytics'], auth };
}
