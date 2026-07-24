# Build & Distribution

## Publish to npm

Use the publish wrapper. Do **not** publish from `dist-package/` by hand.

```bash
./scripts/publish.sh <otp>
```

That is the normal publish command. It reads the latest published `circuschief`
version from npm, bumps the minor version, builds the package, tests the built
artifact, and publishes only if those tests pass.

Example:

```bash
./scripts/publish.sh 123456        # auto-bump the latest npm minor version
```

To publish a specific version instead of auto-bumping, pass it before the OTP:

```bash
./scripts/publish.sh 0.2.0 123456
```

The publish script is the release gate. It will not publish unless the npm artifact builds and passes the package E2E tests.

What `scripts/publish.sh` does:

1. Chooses the version. If no version is provided, it reads the latest `circuschief` version from npm and bumps the minor version.
2. Verifies the publish PostHog config exists.
3. Verifies you are logged in to npm.
4. Builds the npm package artifact for the release version.
5. Packs the artifact into a `.tgz`.
6. Installs that tarball into an isolated temp directory.
7. Starts Circus Chief from the installed package.
8. Runs Playwright against that installed package.
9. Stops immediately if any package test fails.
10. Runs `npm publish --otp=<otp>` from the tested `dist-package/`.

Required before publishing:

- Run `npm login` first.
- Have a 6-digit npm OTP ready.
- Configure `POSTHOG_KEY` or `VITE_POSTHOG_KEY`; publishing fails without it.

## Test the npm artifact locally

Use this when you want to test the same kind of package users get from `npx circuschief`.

```bash
./scripts/pw.sh test-package
```

That command builds the package first. You do **not** need to run `node scripts/build-package.js` before it.

What `test-package` does:

1. Builds `dist-package/`.
2. Runs `npm pack`.
3. Installs the generated tarball into an isolated temp directory.
4. Starts the server from the installed package.
5. Runs Playwright against that installed package.
6. Cleans up the temp install when it exits.

Useful variants:

```bash
./scripts/pw.sh test-package
./scripts/pw.sh test-package --grep="login"
./scripts/pw.sh test-package tests/e2e/auth.spec.ts
VCR_MODE=record ./scripts/pw.sh test-package
```

Use this after changing packaging, publish scripts, server startup, CLI files, runtime dependencies, or anything that might behave differently after `npm pack` and install.

## Normal development tests

For regular source-checkout E2E tests, use:

```bash
./scripts/pw.sh test
```

Mental model:

- `./scripts/pw.sh test` answers: "Does the repo source work?"
- `./scripts/pw.sh test-package` answers: "Does the npm package users install work?"
- `./scripts/publish.sh` runs the package test before publishing.

## Manually build the package

Most people should not need this. Use it only when inspecting the generated package or debugging the build script itself.

```bash
POSTHOG_KEY=phc_test_publish_key node scripts/build-package.js --version=0.0.0-test
cd dist-package
npm pack
npx ./circuschief-0.0.0-test.tgz
```

`scripts/build-package.js` creates `dist-package/`, a publish-ready package tree. It builds the frontend, copies the server and shared package sources, rewrites internal workspace imports, writes package manifests, and verifies the generated artifact.

Do not use the manual build path to publish. Use `./scripts/publish.sh`.

## Analytics config

The frontend is pre-built before publishing, so `VITE_*` values are baked into the package.

PostHog key lookup order:

1. `--posthog-key=...` passed to `scripts/build-package.js`
2. `POSTHOG_KEY`
3. `VITE_POSTHOG_KEY` from `.env.production`

PostHog host lookup order:

1. `--posthog-host=...` passed to `scripts/build-package.js`
2. `POSTHOG_HOST`
3. `VITE_POSTHOG_HOST` from `.env.production`
4. `https://us.i.posthog.com`

Package builds and publishing fail when no PostHog key is configured. Local package tests use a fake test key by default so they do not depend on a developer machine's `.env.production`.

The PostHog client key is public, like a Google Analytics tracking ID. Session recording is disabled, and browser Do Not Track is honored.

## Implementation notes

Circus Chief is published as the `circuschief` npm package. Users run it with:

```bash
npx circuschief
```

The published package includes the pre-built frontend. At runtime, the CLI shim sets `NODE_ENV=production` and starts the Express server, which serves the static frontend files.

`dist-package/` keeps a `packages/` tree so existing server paths keep working. The build script copies:

- `packages/web/dist/`
- `packages/server/src/`, excluding tests
- `packages/server/bin/`
- `packages/shared/src/`

The script rewrites static `@circuschief/shared` imports in copied server code to relative paths. Dynamic imports or `require()` calls for `@circuschief/shared` would need build-script changes.
