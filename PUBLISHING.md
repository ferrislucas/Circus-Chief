# Publishing to npm

This document explains how Circus Chief is packaged for distribution via `npx circuschief`.

## Quick Start

```bash
# Build for publishing — CLI flags
node scripts/build-package.js --version=0.2.0 --posthog-key=phc_xxxxx

# Build for publishing — environment variables (for CI/CD)
POSTHOG_KEY=phc_xxxxx node scripts/build-package.js --version=0.2.0

# Build for local testing (no analytics)
node scripts/build-package.js --version=0.2.0

# Run E2E tests against the built package
./scripts/pw.sh test-package

# Test locally (manual)
cd dist-package && npm pack
cd /tmp && mkdir test && cd test
npm install /path/to/dist-package/circuschief-0.2.0.tgz
npx circuschief

# Publish
cd dist-package && npm publish
```

## PostHog Analytics Configuration

The PostHog API key is a **public client-side key** (always visible in the browser bundle). It's injected at build time via Vite environment variables.

### Resolution order (first non-empty wins)

| Value | CLI flag | Environment variable | Default |
|-------|----------|---------------------|---------|
| API key | `--posthog-key=<key>` | `POSTHOG_KEY` | empty (analytics disabled) |
| API host | `--posthog-host=<host>` | `POSTHOG_HOST` | `https://us.i.posthog.com` |

CLI flags take precedence over environment variables.

- Omitting the key produces a working package with analytics disabled
- `scripts/start-package-server.sh` intentionally provides no key since E2E tests don't need analytics
- After the Vite build, the script verifies the key appears in the output bundle (if one was provided)

### GitHub Actions

```yaml
- name: Build package
  env:
    POSTHOG_KEY: ${{ secrets.POSTHOG_KEY }}
    POSTHOG_HOST: ${{ secrets.POSTHOG_HOST }}  # optional
  run: node scripts/build-package.js --version=${{ github.ref_name }}
```

## How It Works

The app is a monorepo with three packages (`server`, `web`, `shared`) that use Yarn workspace symlinks to reference each other. That structure doesn't survive `npm publish` — when someone runs `npx circuschief`, they get a single flat tarball with no workspace wiring.

`scripts/build-package.js` assembles a publishable package in `dist-package/` by:

1. **Building the frontend** — runs `vite build` to produce static HTML/CSS/JS in `packages/web/dist/`
2. **Copying the source tree** — copies `packages/server/src/`, `packages/shared/src/`, and `packages/web/dist/` into `dist-package/`, preserving the same directory structure
3. **Rewriting imports** — transforms `@circuschief/shared` imports into relative paths (e.g., `../../shared/src/index.js`)
4. **Generating package.json** — merges runtime dependencies from `server` and `shared` into a single flat `package.json`
5. **Writing the CLI entry point** — produces a `bin/cli.js` that sets `NODE_ENV=production` before starting the server

## Why This Approach

### The core problem

The server imports from `@circuschief/shared`:

```js
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { CreateProjectRequest } from '@circuschief/shared/contracts/projects';
```

In the monorepo, Yarn creates symlinks (`node_modules/@circuschief/shared -> ../../packages/shared`) that make these resolve. In a published npm tarball, those symlinks don't exist, so the imports fail.

### Options considered

**Publish `@circuschief/shared` as a separate npm package.** This would make imports resolve naturally, but requires maintaining two npm packages in lockstep — publish shared first, then the main package, keep versions coordinated. Ongoing operational tax for no user benefit.

**Bundle the server with esbuild.** This would inline `shared` into a single output file, eliminating the import problem entirely. However, the server has two `__dirname`-relative filesystem operations:

- `app.js` serves the frontend from `join(__dirname, '../../web/dist')`
- `DatabaseManager.js` reads `schema.sql` from `join(__dirname, '..', 'schema.sql')`

Bundling moves everything into one file, breaking these paths. Solvable (inline the SQL, fix the static path), but adds complexity for edge cases. Also makes production stack traces harder to read.

**Rewrite imports in a build step (chosen).** Copy the source files as-is and mechanically rewrite `@circuschief/shared` to relative paths. The directory structure is preserved, so `__dirname`-relative paths keep working. No bundler, no second package, no path fixups. The only transform is the import rewrite.

### Why preserve the directory structure

The published package mirrors the monorepo layout:

```
dist-package/
  packages/
    server/
      bin/cli.js
      src/          (server source, imports rewritten)
    shared/
      src/          (shared source, copied as-is)
    web/
      dist/         (pre-built frontend)
  package.json
```

This means `join(__dirname, '../../web/dist')` in `app.js` resolves correctly in both the monorepo and the published package. Same for `schema.sql`. No conditional path logic needed.

### What the import rewrite does

The build script walks every `.js` file in `packages/server/src/` and rewrites two patterns:

| Original | Rewritten |
|----------|-----------|
| `from '@circuschief/shared'` | `from '../../shared/src/index.js'` |
| `from '@circuschief/shared/contracts/projects'` | `from '../../shared/src/contracts/projects.js'` |

The relative path depth is calculated per-file based on its position in the directory tree. The `.js` extension is added explicitly because the original imports relied on the shared package's `exports` field for resolution, which isn't available when using direct relative paths.

### What the frontend build does

The Vue frontend is built by Vite into static HTML/CSS/JS. All `@circuschief/shared` imports in the frontend are resolved at build time by Vite's bundler — they're baked into the JavaScript bundles. No runtime resolution needed. The server just serves these files with `express.static()`.

### Test files are excluded

The build script filters out `*.test.js` files from both `server` and `shared` packages. These aren't needed at runtime and would add ~2 MB of unnecessary weight to the tarball.

### The `nanoid` dependency

`nanoid` is used in the server source but isn't declared in `packages/server/package.json` (it resolves via hoisting in the monorepo). The build script explicitly adds it to the published `package.json`.

## E2E Testing Against the Built Package

`./scripts/pw.sh test-package` runs the full Playwright E2E suite against the actual npm artifact. This validates that `npx circuschief` will work for real users — not just that the source code works in the monorepo.

### What it does

1. **Builds the package** — runs `scripts/build-package.js` to produce `dist-package/`
2. **Packs a tarball** — runs `npm pack` inside `dist-package/`, producing a `.tgz` identical to what `npm publish` would upload
3. **Installs in an isolated directory** — creates `.package-test/` with a fresh `package.json` and installs the tarball via `npm install`, simulating a real user install
4. **Symlinks test cassettes** — links `tests/` into the install directory so VCR replay cassettes are reachable at the expected relative path
5. **Starts the server from the installed binary** — runs `node node_modules/.bin/circuschief`, the same entry point a user gets from `npx circuschief`
6. **Runs Playwright tests** — same E2E suite as `./scripts/pw.sh test`, but hitting the package-installed server

### Why this catches issues that `pw.sh test` doesn't

`pw.sh test` builds and runs the source tree in-place with workspace symlinks intact. `pw.sh test-package` exercises the full packaging pipeline — if a file is missing from `package.json` `files`, if a `bin` entry is broken, if an import rewrite was missed, or if a dependency isn't declared, the tests will fail.

### Usage

```bash
# Run all E2E tests against the built package
./scripts/pw.sh test-package

# Run specific tests against the built package
./scripts/pw.sh test-package --grep="session"

# Re-record VCR cassettes while testing the package
VCR_MODE=record ./scripts/pw.sh test-package
```

The command uses VCR replay mode by default (no API key needed) and auto-assigns a worktree-safe port, same as `pw.sh test`.

## What Gets Checked In

- `scripts/build-package.js` — the build script
- `PUBLISHING.md` — this file

## What Doesn't Get Checked In

- `dist-package/` — build artifact, gitignored
- `*.tgz` — npm tarballs, gitignored via `dist-package/`
