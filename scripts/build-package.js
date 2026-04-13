#!/usr/bin/env node

/**
 * Build script to assemble a publishable npm package.
 *
 * Produces dist-package/ with the same packages/ tree shape so that all
 * __dirname-relative paths (schema.sql, ../../web/dist) keep working.
 *
 * The only transform: rewrite `@circuschief/shared` imports to relative paths.
 */

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));
const DIST = join(ROOT, 'dist-package');
const version = process.argv.find(a => a.startsWith('--version='))?.split('=')[1] || '0.1.0';

// --- PostHog configuration ---
// Resolution order (first non-empty wins): CLI flag → env var → default
const posthogKey = process.argv.find(a => a.startsWith('--posthog-key='))?.split('=')[1]
  || process.env.POSTHOG_KEY
  || '';
const posthogHost = process.argv.find(a => a.startsWith('--posthog-host='))?.split('=')[1]
  || process.env.POSTHOG_HOST
  || 'https://us.i.posthog.com';

/** cpSync filter: exclude test files but always keep directories */
const excludeTests = (src) => {
  if (statSync(src).isDirectory()) return true;
  return !src.endsWith('.test.js');
};

// --- 1. Clean ---
console.log('Cleaning dist-package/...');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// --- 2. Build frontend ---
if (!posthogKey) {
  console.log('⚠ No PostHog key provided (--posthog-key or POSTHOG_KEY); analytics will be disabled in this build');
}
console.log('Building frontend...');
// Always explicitly set VITE_POSTHOG_KEY (even when empty) to prevent Vite
// from picking up stale values from any local .env files.
execSync('yarn workspace @circuschief/web build', {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_POSTHOG_KEY: posthogKey,
    VITE_POSTHOG_HOST: posthogHost,
  },
});

// --- 2b. Verify PostHog key in bundle ---
if (posthogKey) {
  const assetsDir = join(ROOT, 'packages/web/dist/assets');
  const jsFiles = readdirSync(assetsDir).filter(f => f.endsWith('.js'));
  const found = jsFiles.some(f =>
    readFileSync(join(assetsDir, f), 'utf-8').includes(posthogKey)
  );
  if (!found) {
    console.error('ERROR: PostHog key was not found in the built frontend bundle');
    process.exit(1);
  }
  console.log('✓ PostHog key verified in frontend bundle');
}

// --- 3. Copy files preserving tree shape ---
console.log('Copying packages/web/dist...');
cpSync(join(ROOT, 'packages/web/dist'), join(DIST, 'packages/web/dist'), { recursive: true });

console.log('Copying packages/server/src (excluding tests)...');
cpSync(join(ROOT, 'packages/server/src'), join(DIST, 'packages/server/src'), {
  recursive: true,
  filter: excludeTests,
});

console.log('Copying packages/shared/src (excluding tests)...');
cpSync(join(ROOT, 'packages/shared/src'), join(DIST, 'packages/shared/src'), {
  recursive: true,
  filter: excludeTests,
});

// Copy shared package.json (needed for exports resolution)
cpSync(join(ROOT, 'packages/shared/package.json'), join(DIST, 'packages/shared/package.json'));

console.log('Copying packages/server/bin...');
cpSync(join(ROOT, 'packages/server/bin'), join(DIST, 'packages/server/bin'), { recursive: true });

// --- 4. Rewrite @circuschief/shared imports to relative paths ---
console.log('Rewriting @circuschief/shared imports...');

function rewriteFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');

  // Calculate relative path from this file to packages/shared/src/
  const fileDir = dirname(filePath);
  const sharedSrcDir = join(DIST, 'packages/shared/src');
  let relPath = relative(fileDir, sharedSrcDir);

  // Ensure it starts with ./ or ../
  if (!relPath.startsWith('.')) {
    relPath = './' + relPath;
  }

  let updated = content;

  // NOTE: Only static `import ... from '...'` syntax is rewritten here.
  // If require() or dynamic import() of @circuschief/shared are introduced,
  // this script must be updated to handle those patterns as well.
  //
  // Rewrite: from '@circuschief/shared/contracts/foo' → relative path to shared/src/contracts/foo
  // Rewrite: from '@circuschief/shared' → relative path to shared/src/index.js
  updated = updated.replace(
    /from\s+['"]@circuschief\/shared\/([^'"]+)['"]/g,
    (match, subpath) => `from '${relPath}/${subpath}.js'`
  );
  updated = updated.replace(
    /from\s+['"]@circuschief\/shared['"]/g,
    `from '${relPath}/index.js'`
  );

  if (updated !== content) {
    writeFileSync(filePath, updated);
    return true;
  }
  return false;
}

function walkJs(dir) {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      count += walkJs(full);
    } else if (full.endsWith('.js')) {
      if (rewriteFile(full)) count++;
    }
  }
  return count;
}

const rewritten = walkJs(join(DIST, 'packages/server'));
console.log(`  Rewrote imports in ${rewritten} files.`);

// --- 5. Write publish-ready package.json ---
console.log('Writing package.json...');

const serverPkg = JSON.parse(readFileSync(join(ROOT, 'packages/server/package.json'), 'utf-8'));
const sharedPkg = JSON.parse(readFileSync(join(ROOT, 'packages/shared/package.json'), 'utf-8'));

// Merge runtime deps (server + shared), excluding workspace references
const deps = { ...sharedPkg.dependencies, ...serverPkg.dependencies };
delete deps['@circuschief/shared'];

const publishPkg = {
  name: 'circuschief',
  version,
  description: 'Local-first web UI for managing Claude Code sessions',
  type: 'module',
  bin: {
    circuschief: './packages/server/bin/cli.js',
  },
  files: [
    'packages/server/bin/',
    'packages/server/src/',
    'packages/shared/src/',
    'packages/shared/package.json',
    'packages/web/dist/',
  ],
  engines: {
    node: '>=18',
  },
  dependencies: deps,
};

writeFileSync(join(DIST, 'package.json'), JSON.stringify(publishPkg, null, 2) + '\n');

// --- 6. Write CLI entry point ---
// This intentionally overwrites the dev cli.js copied in step 3 with a
// production version that sets NODE_ENV=production before starting the server.
console.log('Writing bin/cli.js...');

const cli = `#!/usr/bin/env node

process.env.NODE_ENV = 'production';
import '../src/index.js';
`;

writeFileSync(join(DIST, 'packages/server/bin/cli.js'), cli);

// --- Done ---
console.log('');
console.log('Package built in dist-package/');
console.log('');
console.log('To test locally:');
console.log('  cd dist-package && npm pack');
console.log(`  npx ./dist-package/circuschief-${version}.tgz`);
console.log('');
console.log('To publish:');
console.log('  cd dist-package && npm publish');
