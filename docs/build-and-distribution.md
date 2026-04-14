# Build & Distribution

## How it works

Circus Chief is distributed as an npm package. End users run it via `npx circuschief` — no build step required on their machine.

The build/publish/run flow:

1. **Build** (`yarn build`): Vite compiles the Vue.js frontend into static assets (`packages/web/dist/`). Server-side code requires no compilation.
2. **Publish** (`npm publish`): The package ships with the pre-built frontend included.
3. **Run** (`npx circuschief`): The Express server starts and serves the pre-built frontend as static files.

## Build-time vs runtime variables

Because the frontend is pre-compiled, there are two categories of environment variables:

| Category | When resolved | Who controls it | Examples |
|----------|---------------|-----------------|----------|
| **Build-time** (`VITE_*`) | During `yarn build` — Vite string-replaces them into the JS bundle | Publisher / CI | `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` |
| **Runtime** (`process.env`) | When the server starts | End user | `PORT`, `DB_PATH`, `NODE_ENV` |

End users **cannot** configure `VITE_*` variables — they are baked into the JS bundle before the package is published. This is intentional for variables like analytics keys, which are the publisher's concern, not the user's.

## Building for production

```bash
# Install dependencies
yarn install --frozen-lockfile

# Build (set VITE_* vars for the frontend bundle)
yarn build

# Start server (serves frontend static files)
NODE_ENV=production yarn workspace @circuschief/server start
```

## Publishing to npm

```bash
# Build with analytics enabled
yarn build

# Verify the PostHog key is in the bundle (optional)
grep -l phc_ packages/web/dist/assets/*.js

# Publish
npm publish
```

## Analytics

This application uses [PostHog](https://posthog.com) for anonymous usage analytics (page views, clicks). **Session recording is disabled.**

- Analytics are configured at build time via `VITE_POSTHOG_KEY` in `.env.production`
- When the key is empty (local dev, CI, contributor forks), analytics are completely disabled — no PostHog code loads, no network requests are made
- The PostHog client API key is a public key (like a Google Analytics tracking ID), not a secret
- Browser Do Not Track (`respect_dnt: true`) is honored
