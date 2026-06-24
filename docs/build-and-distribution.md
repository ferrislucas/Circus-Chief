# Build & Distribution

## How it works

Circus Chief is distributed as an npm package named `circuschief`. End users run it via `npx circuschief` — no build step required on their machine.

The build/publish/run flow:

1. **Build** (`node scripts/build-package.js`): Verifies PostHog publish configuration, Vite compiles the Vue.js frontend into static assets, then the script assembles a publish-ready tree under `dist-package/`. Server-side code requires no compilation — the JS sources are copied as-is and `@circuschief/shared` imports are rewritten to relative paths so the package can run without workspace tooling.
2. **Publish** (`scripts/publish.sh`): Verifies PostHog publish configuration before npm login or build, runs the build, then `npm publish` from `dist-package/`. The package ships with the pre-built frontend included.
3. **Run** (`npx circuschief`): The `bin/cli.js` shim sets `NODE_ENV=production` and starts the Express server, which serves the pre-built frontend as static files.

## Build-time vs runtime variables

Because the frontend is pre-compiled, there are two categories of environment variables:

| Category | When resolved | Who controls it | Examples |
|----------|---------------|-----------------|----------|
| **Build-time** (`VITE_*`) | During the frontend build — Vite string-replaces them into the JS bundle | Publisher / CI | `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` |
| **Runtime** (`process.env`) | When the server starts | End user | `PORT`, `DB_PATH`, `NODE_ENV` |

End users **cannot** configure `VITE_*` variables — they are baked into the JS bundle before the package is published. This is intentional for variables like analytics keys, which are the publisher's concern, not the user's.

## Building for local development

```bash
# Install dependencies
yarn install --frozen-lockfile

# Build (set VITE_* vars for the frontend bundle)
yarn build

# Start server (serves frontend static files)
NODE_ENV=production yarn workspace @circuschief/server start
```

## Building the publishable package

`scripts/build-package.js` produces `dist-package/`, a self-contained tree shaped like the monorepo so that `__dirname`-relative paths (e.g. `schema.sql`, `../../web/dist`) keep working.

```bash
# Build the publishable package (defaults to version 0.1.0 if --version is omitted)
POSTHOG_KEY=phc_xxxxx node scripts/build-package.js --version=0.2.0
```

What the script does:

1. Cleans and recreates `dist-package/`.
2. Builds the frontend with `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` injected.
3. Requires a PostHog key and **verifies** the key appears in one of the built JS bundles, failing the build if it doesn't.
4. Copies `packages/web/dist/`, `packages/server/src/` (minus `*.test.js`), `packages/server/bin/`, and `packages/shared/src/` into `dist-package/packages/...`.
5. Rewrites all `from '@circuschief/shared'` / `from '@circuschief/shared/...'` imports in the copied server code to relative paths into `packages/shared/src/`. **Only static `import ... from '...'` syntax is handled** — `require()` and dynamic `import()` of `@circuschief/shared` would need script changes.
6. Writes a publish-ready `dist-package/package.json` with:
   - `name: circuschief`, the given `--version`, `type: module`, `bin.circuschief`, `engines.node: >=18`
   - Merged runtime deps from `server` + `shared` (workspace reference to `@circuschief/shared` removed)
   - A `files` array limiting the published tarball to `packages/server/bin/`, `packages/server/src/`, `packages/server/package.json`, `packages/shared/src/`, `packages/shared/package.json`, and `packages/web/dist/`
7. Writes sanitized internal `packages/server/package.json` and `packages/shared/package.json` manifests with the publish version and no workspace-only scripts or dependency metadata.
8. Overwrites `packages/server/bin/cli.js` with a production shim that sets `NODE_ENV=production` and imports `../src/index.js`.
9. Verifies the generated artifact versions, internal manifests, CLI `--version` output, and absence of stale internal workspace references.

### Testing the package locally

```bash
POSTHOG_KEY=phc_test_publish_key node scripts/build-package.js --version=0.0.0-test
cd dist-package
npm pack
# Then from any directory:
npx ./circuschief-0.0.0-test.tgz
```

## Running E2E tests against the built package

The normal `./scripts/pw.sh test` flow runs Playwright against a dev server started from the repo source. That is the right default for day-to-day development, but it does not exercise the exact npm artifact users install.

To catch issues that only appear in the published package — missing files from the `files` whitelist, broken `@circuschief/shared` import rewrites, a stale `cli.js`, missing runtime dependencies, or packaging mistakes that only show up after `npm pack` and `npm install` — use the `test-package` variant:

```bash
./scripts/pw.sh test-package                           # Run all E2E tests against the built package
./scripts/pw.sh test-package --grep="login"            # Filter by test name
./scripts/pw.sh test-package tests/e2e/auth.spec.ts    # Run a specific test file

# VCR mode is forwarded through to the package server
VCR_MODE=record ./scripts/pw.sh test-package
```

### What `test-package` does

Under the hood, `pw.sh test-package` sets `USE_PACKAGE_SERVER=true` and delegates server startup to `scripts/start-package-server.sh`, which reproduces a realistic end-user install. The key difference is that the server is launched from an installed tarball, not from the repo checkout.

1. Runs `scripts/build-package.js` with `POSTHOG_KEY=phc_test_package_key` by default to produce `dist-package/`.
2. `cd dist-package && npm pack` to produce a `circuschief-<version>.tgz` tarball.
3. Creates an isolated temp install directory (`$TMPDIR/circuschief-package-test.XXXXXX`) with a minimal `package.json`.
4. `npm install`s the tarball into that directory — this is the same path `npx circuschief` takes for real users.
5. Symlinks the repo's `tests/` directory into the install dir so VCR cassettes (resolved relative to cwd) are reachable.
6. Picks a port using the same worktree-aware rules as `start-server.sh` (main repo → 5000 if free, worktrees → 5001+), writes it to `.server-port`, and writes the absolute DB path to `.db-path`.
7. Starts the server via `node node_modules/.bin/circuschief -p <port>` with `DB_PATH` set to an absolute path in the temp dir.
8. On exit, kills the server and removes the temp dir, `.server-port`, `.db-path`, and `.vcr-mode` marker files.

Meanwhile `pw.sh test-package` keeps the Playwright side aligned with that installed copy:

- Queries `GET /api/server-info` after the package server is ready, asserts the server's reported `dbPath` is **not** the user's home DB (`~/.circuschief/circuschief.db`), then re-exports that path as `DB_PATH` so seed scripts (e.g. `scripts/seed-*.mjs`) write to the **same** database the package server is using — otherwise seeds would go to a default cwd-relative file and the server would see an empty DB.
- Also asserts the server's `schedulerRunning` is `false` (VCR_MODE propagates through `start-package-server.sh` to the server's `schedulerService.startIfEnabled()` gate). If either check fails, pw.sh exits non-zero before any test runs.
- Does **not** overwrite `DB_PATH` before starting the package server — `setup_isolated_test_db` intentionally clears it so `start-package-server.sh` owns the DB location (an isolated mktemp dir). The dev-server path (`./scripts/pw.sh test`) uses a different worktree-local DB at `$PROJECT_ROOT/.circuschief-test.db`; see [E2E testing](./e2e-testing.md) for the full DB-path matrix.
- Sets `BASE_URL` / `API_URL` to `http://localhost:<port>` and runs Playwright via local `npx playwright`.
- Uses a longer startup timeout (180s vs 120s) to cover the extra build + `npm install` steps.

### When to use it

- **Before publishing** - run `./scripts/pw.sh test-package` immediately before `scripts/publish.sh` so you validate the same artifact shape that will be uploaded to npm.
- **After packaging changes** - rerun it after changes to `scripts/build-package.js`, `scripts/start-package-server.sh`, `packages/server/bin/`, the package `files` list, or any runtime path that behaves differently in the published tree.
- **When debugging an install-only failure** - if something works in `./scripts/pw.sh test` but fails after `npx circuschief`, this is the command to reproduce it locally.

### Useful mental model

- `./scripts/pw.sh test` answers: "Does the repo source work under Playwright?"
- `./scripts/pw.sh test-package` answers: "Does the npm package users install work under Playwright?"
- If both pass, you have coverage for both the source checkout and the published artifact.

Regular `./scripts/pw.sh test` is still the fast path for normal development — `test-package` adds a full build + `npm pack` + `npm install` on every invocation.

## Publishing to npm

Use `scripts/publish.sh`, which wraps the build and `npm publish`:

```bash
# Usage: ./scripts/publish.sh [version] <otp>

# Examples:
./scripts/publish.sh 123456             # auto-bump minor, publish
./scripts/publish.sh 0.2.0 123456       # publish exactly 0.2.0
```

Arguments:

- `version` — Optional semver version to publish (e.g. `0.2.0`). If omitted, the script bumps the minor version of the latest published npm version. Passed through to `build-package.js` as `--version=`.
- `otp` — Required npm one-time password for 2FA (6 digits). Passed to `npm publish --otp=`.

What the script does:

1. If `version` is omitted, queries npm for the latest published version and auto-bumps the minor version (e.g. `1.4.2` → `1.5.0`).
2. Verifies a PostHog key is configured and aborts before npm login, build, or `npm publish` when absent.
3. Verifies you're logged in (`npm whoami`) and aborts with an error if not.
4. Runs `node scripts/build-package.js --version=$VERSION`.
5. Runs `npm publish --otp=$OTP` from inside `dist-package/`.
6. Prints install/run hints (`npx circuschief`, `npx circuschief@<version>`).

Before publishing, make sure `POSTHOG_KEY` or `VITE_POSTHOG_KEY` is available via one of the sources listed below. The PostHog client key is public, but publishing requires it to be intentionally configured.

## Analytics

This application uses [PostHog](https://posthog.com) for anonymous usage analytics (page views, clicks). **Session recording is disabled.**

- Analytics are configured at build time via `VITE_POSTHOG_KEY`.
- `scripts/build-package.js` resolves the key from the following sources, first non-empty wins:
  1. `--posthog-key=...` CLI flag on `build-package.js`
  2. `POSTHOG_KEY` environment variable
  3. `VITE_POSTHOG_KEY` from `.env.production` in the repo root
- The PostHog host is resolved the same way (`--posthog-host=...` / `POSTHOG_HOST` / `VITE_POSTHOG_HOST`) and defaults to `https://us.i.posthog.com`.
- Package builds and publishing fail when no key is provided. Package E2E startup provides a fake test key by default so tests do not depend on a developer machine's `.env.production`.
- The build **fails** if the key is not found in the generated JS bundle, so you can't accidentally ship a build with analytics missing.
- The PostHog client API key is a public key (like a Google Analytics tracking ID), not a secret.
- Browser Do Not Track (`respect_dnt: true`) is honored.
