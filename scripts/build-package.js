#!/usr/bin/env node

/**
 * Build script to assemble a publishable npm package.
 *
 * Produces dist-package/ with the same packages/ tree shape so that all
 * __dirname-relative paths (schema.sql, ../../web/dist) keep working.
 *
 * The only transform: rewrite `@claudetools/shared` imports to relative paths.
 */

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));
const DIST = join(ROOT, 'dist-package');

// --- 1. Clean ---
console.log('Cleaning dist-package/...');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// --- 2. Build frontend ---
console.log('Building frontend...');
execSync('yarn workspace @claudetools/web build', { cwd: ROOT, stdio: 'inherit' });

// --- 3. Copy files preserving tree shape ---
console.log('Copying packages/web/dist...');
cpSync(join(ROOT, 'packages/web/dist'), join(DIST, 'packages/web/dist'), { recursive: true });

console.log('Copying packages/shared/src...');
cpSync(join(ROOT, 'packages/shared/src'), join(DIST, 'packages/shared/src'), { recursive: true });

// Copy shared package.json (needed for exports resolution)
cpSync(join(ROOT, 'packages/shared/package.json'), join(DIST, 'packages/shared/package.json'));

console.log('Copying packages/server/src...');
cpSync(join(ROOT, 'packages/server/src'), join(DIST, 'packages/server/src'), {
  recursive: true,
  filter: (src) => !src.endsWith('.test.js'),
});

console.log('Copying packages/shared/src (excluding tests)...');
// Re-copy shared without test files (overwrite the previous copy)
rmSync(join(DIST, 'packages/shared/src'), { recursive: true, force: true });
cpSync(join(ROOT, 'packages/shared/src'), join(DIST, 'packages/shared/src'), {
  recursive: true,
  filter: (src) => !src.endsWith('.test.js'),
});

console.log('Copying packages/server/bin...');
cpSync(join(ROOT, 'packages/server/bin'), join(DIST, 'packages/server/bin'), { recursive: true });

// --- 4. Rewrite @claudetools/shared imports to relative paths ---
console.log('Rewriting @claudetools/shared imports...');

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

  // Rewrite: from '@claudetools/shared/contracts/foo' → relative path to shared/src/contracts/foo
  // Rewrite: from '@claudetools/shared' → relative path to shared/src/index.js
  updated = updated.replace(
    /from\s+['"]@claudetools\/shared\/([^'"]+)['"]/g,
    (match, subpath) => `from '${relPath}/${subpath}.js'`
  );
  updated = updated.replace(
    /from\s+['"]@claudetools\/shared['"]/g,
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
delete deps['@claudetools/shared'];

// Add undeclared runtime deps (used in server but not in its package.json)
deps['nanoid'] = '^5.0.0';

const publishPkg = {
  name: 'claudetools',
  version: '0.1.0',
  description: 'Local-first web UI for managing Claude Code sessions',
  type: 'module',
  bin: {
    claudetools: './packages/server/bin/cli.js',
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
console.log('  npx ./dist-package/claudetools-0.1.0.tgz');
console.log('');
console.log('To publish:');
console.log('  cd dist-package && npm publish');
