import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export function loadEnvProduction(root) {
  const vars = {};
  const envProdPath = join(root, '.env.production');

  if (!existsSync(envProdPath)) {
    return vars;
  }

  const lines = readFileSync(envProdPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }

  return vars;
}

function getArgValue(argv, flag) {
  return argv.find(arg => arg.startsWith(`${flag}=`))?.split('=')[1] || '';
}

export function resolvePostHogConfig({ root, argv = [], env = process.env }) {
  const dotenvVars = loadEnvProduction(root);

  return {
    key: getArgValue(argv, '--posthog-key')
      || env.POSTHOG_KEY
      || dotenvVars.VITE_POSTHOG_KEY
      || '',
    host: getArgValue(argv, '--posthog-host')
      || env.POSTHOG_HOST
      || dotenvVars.VITE_POSTHOG_HOST
      || 'https://us.i.posthog.com',
    loadedEnvProduction: Object.keys(dotenvVars).length > 0,
  };
}

export function requirePostHogKey(config, context = 'build') {
  if (config.key) {
    return;
  }

  if (context === 'publish') {
    console.error('ERROR: npm publish aborted because PostHog key is missing.');
    console.error('Provide it via POSTHOG_KEY or VITE_POSTHOG_KEY in .env.production.');
  } else {
    console.error('ERROR: PostHog key is required to build a publishable package.');
    console.error('  Provide it via --posthog-key=<key>, POSTHOG_KEY env var, or VITE_POSTHOG_KEY in .env.production');
  }
  process.exit(1);
}
