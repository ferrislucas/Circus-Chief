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

  return { port, disableAnalytics: values['no-analytics'] };
}
