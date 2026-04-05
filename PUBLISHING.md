# Publishing to npm

This document explains how claudetools is packaged for distribution via `npx claudetools`.

## Quick Start

```bash
# Build for publishing — CLI flags
node scripts/build-package.js --version=0.2.0 --posthog-key=phc_xxxxx

# Build for publishing — environment variables (for CI/CD)
POSTHOG_KEY=phc_xxxxx node scripts/build-package.js --version=0.2.0

# Build for local testing (no analytics)
node scripts/build-package.js --version=0.2.0

# Test locally
cd dist-package && npm pack
cd /tmp && mkdir test && cd test
npm install /path/to/dist-package/claudetools-0.2.0.tgz
npx claudetools

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

The app is a monorepo with three packages (`server`, `web`, `shared`) that use Yarn workspace symlinks to reference each other. That structure doesn't survive `npm publish` — when someone runs `npx claudetools`, they get a single flat tarball with no workspace wiring.

`scripts/build-package.js` assembles a publishable package in `dist-package/` by:

1. **Building the frontend** — runs `vite build` to produce static HTML/CSS/JS in `packages/web/dist/`
2. **Copying the source tree** — copies `packages/server/src/`, `packages/shared/src/`, and `packages/web/dist/` into `dist-package/`, preserving the same directory structure
3. **Rewriting imports** — transforms `@claudetools/shared` imports into relative paths (e.g., `../../shared/src/index.js`)
4. **Generating package.json** — merges runtime dependencies from `server` and `shared` into a single flat `package.json`
5. **Writing the CLI entry point** — produces a `bin/cli.js` that sets `NODE_ENV=production` before starting the server

## Why This Approach

### The core problem

The server imports from `@claudetools/shared`:

```js
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { CreateProjectRequest } from '@claudetools/shared/contracts/projects';
```

In the monorepo, Yarn creates symlinks (`node_modules/@claudetools/shared -> ../../packages/shared`) that make these resolve. In a published npm tarball, those symlinks don't exist, so the imports fail.

### Options considered

**Publish `@claudetools/shared` as a separate npm package.** This would make imports resolve naturally, but requires maintaining two npm packages in lockstep — publish shared first, then the main package, keep versions coordinated. Ongoing operational tax for no user benefit.

**Bundle the server with esbuild.** This would inline `shared` into a single output file, eliminating the import problem entirely. However, the server has two `__dirname`-relative filesystem operations:

- `app.js` serves the frontend from `join(__dirname, '../../web/dist')`
- `DatabaseManager.js` reads `schema.sql` from `join(__dirname, '..', 'schema.sql')`

Bundling moves everything into one file, breaking these paths. Solvable (inline the SQL, fix the static path), but adds complexity for edge cases. Also makes production stack traces harder to read.

**Rewrite imports in a build step (chosen).** Copy the source files as-is and mechanically rewrite `@claudetools/shared` to relative paths. The directory structure is preserved, so `__dirname`-relative paths keep working. No bundler, no second package, no path fixups. The only transform is the import rewrite.

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
| `from '@claudetools/shared'` | `from '../../shared/src/index.js'` |
| `from '@claudetools/shared/contracts/projects'` | `from '../../shared/src/contracts/projects.js'` |

The relative path depth is calculated per-file based on its position in the directory tree. The `.js` extension is added explicitly because the original imports relied on the shared package's `exports` field for resolution, which isn't available when using direct relative paths.

### What the frontend build does

The Vue frontend is built by Vite into static HTML/CSS/JS. All `@claudetools/shared` imports in the frontend are resolved at build time by Vite's bundler — they're baked into the JavaScript bundles. No runtime resolution needed. The server just serves these files with `express.static()`.

### Test files are excluded

The build script filters out `*.test.js` files from both `server` and `shared` packages. These aren't needed at runtime and would add ~2 MB of unnecessary weight to the tarball.

### The `nanoid` dependency

`nanoid` is used in the server source but isn't declared in `packages/server/package.json` (it resolves via hoisting in the monorepo). The build script explicitly adds it to the published `package.json`.

## What Gets Checked In

- `scripts/build-package.js` — the build script
- `PUBLISHING.md` — this file

## What Doesn't Get Checked In

- `dist-package/` — build artifact, gitignored
- `*.tgz` — npm tarballs, gitignored via `dist-package/`
