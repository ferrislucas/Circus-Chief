#!/usr/bin/env node

import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { requirePostHogKey, resolvePostHogConfig } from './posthog-publish-config.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));

const config = resolvePostHogConfig({
  root: ROOT,
  argv: process.argv.slice(2),
  env: process.env,
});

requirePostHogKey(config, 'publish');
