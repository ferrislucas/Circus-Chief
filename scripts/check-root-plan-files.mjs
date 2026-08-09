#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// This is an established, permanent engineering standards document. New
// planning artifacts belong on the canvas or in ~/.claude/plans instead.
const approvedRootPlanFiles = new Set(['eslint-tightening-plan.md']);
const rootPlanFiles = readdirSync(repositoryRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('-plan.md') && !approvedRootPlanFiles.has(entry.name))
  .map((entry) => entry.name);

if (rootPlanFiles.length) {
  console.error('Repository-root plan files are not allowed. Keep planning artifacts on the canvas or in ~/.claude/plans:');
  for (const filename of rootPlanFiles) console.error(`- ${filename}`);
  process.exitCode = 1;
}
