#!/usr/bin/env bash
##
# Focused checks for the generated dist-package artifact.
##
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="0.2.0"
ENV_PROD="$ROOT/.env.production"
ENV_PROD_BACKUP=""
MISSING_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/circuschief-missing-posthog.XXXXXX")

cleanup() {
  if [ -n "$ENV_PROD_BACKUP" ] && [ -f "$ENV_PROD_BACKUP" ]; then
    mv "$ENV_PROD_BACKUP" "$ENV_PROD"
  fi
  rm -f "$MISSING_OUTPUT"
}
trap cleanup EXIT

echo "=== Package artifact checks ==="

echo "Checking missing PostHog key fails before artifact build..."
rm -rf "$ROOT/dist-package"
if [ -f "$ENV_PROD" ]; then
  ENV_PROD_BACKUP=$(mktemp "${TMPDIR:-/tmp}/circuschief-env-production.XXXXXX")
  mv "$ENV_PROD" "$ENV_PROD_BACKUP"
fi
if env -u POSTHOG_KEY -u VITE_POSTHOG_KEY -u POSTHOG_HOST -u VITE_POSTHOG_HOST \
  node "$ROOT/scripts/build-package.js" --version=0.0.0-test >"$MISSING_OUTPUT" 2>&1; then
  echo "FAIL: build succeeded without PostHog key"
  cat "$MISSING_OUTPUT"
  exit 1
fi
if [ -n "$ENV_PROD_BACKUP" ] && [ -f "$ENV_PROD_BACKUP" ]; then
  mv "$ENV_PROD_BACKUP" "$ENV_PROD"
  ENV_PROD_BACKUP=""
fi

if [ -d "$ROOT/dist-package" ]; then
  echo "FAIL: dist-package was produced without PostHog key"
  cat "$MISSING_OUTPUT"
  exit 1
fi

echo "Building package with test PostHog key..."
POSTHOG_KEY=phc_test_publish_key node "$ROOT/scripts/build-package.js" --version="$VERSION"

echo "Checking generated manifests and CLI version..."
node --input-type=module <<'NODE'
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const expected = '0.2.0';
const readJson = path => JSON.parse(readFileSync(path, 'utf-8'));
const rootPkg = readJson('dist-package/package.json');
const serverPkg = readJson('dist-package/packages/server/package.json');
const sharedPkg = readJson('dist-package/packages/shared/package.json');

for (const [label, pkg] of [
  ['root', rootPkg],
  ['server', serverPkg],
  ['shared', sharedPkg],
]) {
  if (pkg.version !== expected) {
    throw new Error(`${label} version expected ${expected}, got ${pkg.version}`);
  }
}

if (rootPkg.dependencies?.['@circuschief/shared']) {
  throw new Error('root manifest contains @circuschief/shared dependency');
}

for (const [label, pkg] of [
  ['server', serverPkg],
  ['shared', sharedPkg],
]) {
  const serializedDeps = JSON.stringify({
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies,
  });
  if (serializedDeps.includes('@circuschief/')) {
    throw new Error(`${label} manifest contains stale workspace dependency metadata`);
  }
}

const cliVersion = execSync('node dist-package/packages/server/bin/cli.js --version', {
  encoding: 'utf-8',
}).trim();
if (cliVersion !== expected) {
  throw new Error(`CLI version expected ${expected}, got ${cliVersion}`);
}
NODE

echo "Package artifact checks passed."
