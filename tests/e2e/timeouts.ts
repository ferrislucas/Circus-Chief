/**
 * Worker-aware timeout constants for E2E tests.
 *
 * Playwright runs tests against a single shared server process, so as worker
 * count grows the server becomes correspondingly slower per request. These
 * constants scale linearly with worker count so that fixed per-step waits
 * don't starve under higher parallelism.
 *
 * Detection priority:
 *   1. Explicit env override: PW_WORKERS
 *   2. Sniff --workers / --workers=N from process.argv (covers `npx playwright test --workers=N`)
 *   3. Read `workers` from playwright.config.ts (default 4)
 *
 * At the repository default of 4 workers the scale factor is 1 and all
 * constants match their baseline values.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires -- dynamic require keeps this file usable from tests without pulling the Playwright runner into compile units that only need the constants
const playwrightConfig = require('../../playwright.config').default;

/**
 * Pure detection logic — exposed for unit testing. Accepts explicit env,
 * argv, and config-worker values so tests can cover every branch without
 * monkey-patching process globals.
 *
 * Precedence:
 *   1) PW_WORKERS env override
 *   2) `--workers N` / `--workers=N` in argv
 *   3) config `workers` value
 *   4) default of 4
 */
export function detectWorkersFrom(
  env: NodeJS.ProcessEnv,
  argv: string[],
  configWorkers: unknown,
): number {
  // 1) Honor explicit env override (CI can set this)
  if (env.PW_WORKERS) {
    const n = Number(env.PW_WORKERS);
    if (!Number.isNaN(n) && n > 0) return n;
  }

  // 2) Sniff --workers from argv when run via npx playwright
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workers' && argv[i + 1]) {
      const n = Number(argv[i + 1]);
      if (!Number.isNaN(n) && n > 0) return n;
    }
    if (a.startsWith('--workers=')) {
      const n = Number(a.slice('--workers='.length));
      if (!Number.isNaN(n) && n > 0) return n;
    }
  }

  // 3) Fall back to config
  const configured = Number(configWorkers);
  if (!Number.isNaN(configured) && configured > 0) return configured;
  return 4;
}

function detectWorkers(): number {
  return detectWorkersFrom(process.env, process.argv, playwrightConfig?.workers);
}

export const WORKERS = detectWorkers();

// Scale factor: 1.0 at the configured default of 4 workers, grows linearly.
const scale = Math.max(1, WORKERS / 4);

/**
 * Upper bound on "page has rendered a terminal state" — covers skeleton
 * transition, data fetch, and store hydration.
 */
export const PAGE_READY_TIMEOUT = Math.round(15000 * scale);

/**
 * Upper bound on the session-detail -> chat-handle -> overlay sequence,
 * which is the slowest common path in the UI.
 */
export const OVERLAY_TIMEOUT = Math.round(20000 * scale);

/**
 * Upper bound on list views populating a specific row after a backend
 * write (e.g. a newly seeded session appearing in `/sessions/active`).
 */
export const LIST_HYDRATION = Math.round(10000 * scale);

/**
 * Upper bound on a REST API call reaching a specific desired state
 * (e.g. waitForSessionStatus polling).
 */
export const API_READY = Math.round(5000 * scale);
