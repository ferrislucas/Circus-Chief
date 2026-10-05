// Finding #5 (test hermeticity): unit tests must never spawn the user's real
// login shell. This file is intentionally import-free and is listed FIRST in
// vitest `setupFiles`, so the disable flag is set before any module (including
// setup.js's database import) can trigger the login-shell probe. Env
// derivation tests inject `shellEnv` fixtures instead (FR-13 fallback covers
// the disabled probe: it yields an empty derivation, like a broken shell).
process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL = '1';
