# Functional Requirements Document: Muse Agent User-Shell Environment Parity

**Feature:** Muse coding agent uses the same shell commands and environment as the user's command line
**Status:** Proposed
**Date:** 2026-09-27
**Related:** PR #1136 (Muse provider adapter via `@muse-code/sdk`), follow-up fix `a30f2ef9`

## 1. Objective

A Muse agent session running through Circus Chief must be able to run the same
shell commands, with the same binaries, configuration, and credentials, as the
user running those commands directly in their own terminal. Concretely, if
these work on the user's command line, they must also work inside a Muse agent
turn:

- `git status`, `git commit`, `git push` / `git pull` (including SSH remotes
  and commit signing)
- `gh` CLI commands (e.g. `gh auth status`, `gh pr create`, `gh repo view`)
- Any user-installed binary on the user's `PATH` (including `muse` itself)
- User shell environment variables the user's workflows depend on

Today they do not: the Muse agent's shell sees a different, sparser
environment, so git/gh operations fail with missing authorization even though
the user's terminal succeeds.

## 2. Background

### 2.1 How the Muse adapter spawns work

PR #1136 added `MuseAdapter` (`packages/server/src/agents/adapters/MuseAdapter.js`),
which drives one owned `muse serve` host process per turn through the
`@muse-code/sdk` `MuseClient.spawn()` facade, then opens an MSP session on it.
Shell tools (git, gh, file edits, builds) execute as children of that host.

### 2.2 Root cause: the host environment replaces, not inherits

Two facts combine to break credential and binary resolution:

1. **The SDK replaces the child environment.** `MuseClient.spawn()` forwards
   its `env` option straight to Node `child_process.spawn()` with no merge
   against `process.env` (verified in
   `node_modules/@muse-code/sdk/dist/src/connection/spawn.js`,
   `MuseServeChild.spawn`). Under Node semantics, passing `env` **replaces**
   the entire environment. Whatever the adapter does not explicitly include
   is invisible to `muse serve` and to every tool it shells out to.
2. **The adapter's env is a snapshot of the server process env, not the
   user's login shell.** The host env is built by `buildMuseHostEnv()` from
   `options.env` (the session env), which itself starts from
   `createRobustEnv(process.env)` (`sessionProvider.js` → `buildSessionEnv`).
   `process.env` is captured once at server launch. When the server runs in a
   sparse launch context (GUI app, launchd daemon, container, service
   manager), that snapshot lacks entries that only exist in an interactive
   login shell: dotfile-configured `PATH` entries, `SSH_AUTH_SOCK`,
   user-exported tokens, version-manager shims, and similar.

The follow-up fix `a30f2ef9` hardened `createRobustEnv` with `HOME`/`USER`/
`LOGNAME` fallbacks and appended `/opt/homebrew/bin` + `/usr/local/bin`.
That closes the narrowest failures (gh config lookup via `HOME`, git/gh
binaries installed in those two dirs) but does **not** achieve parity, as
§2.3 shows.

### 2.3 Observed gaps (this machine, 2026-09-27)

| Signal | User login shell (`zsh -lic`) | Sparse server snapshot risk |
| --- | --- | --- |
| `PATH` entries | ~20 entries incl. `~/.local/bin`, `~/.cargo/bin`, nvm, rbenv, `/opt/local/bin` | Only what the launcher provided + node dir + 2 appended dirs |
| `muse` binary | `~/.local/bin/muse` — **not** in either hardcoded dir | `MUSE_CLI_NOT_FOUND` if launcher `PATH` lacks it |
| `SSH_AUTH_SOCK` | `/private/tmp/com.apple.launchd…/Listeners` (launchd-provided; absent under many daemon contexts, Linux systemd units, containers) | Missing → SSH git remotes and SSH commit signing fail |
| `GH_TOKEN` / `GITHUB_TOKEN` | User-exported in dotfiles or keychain-backed; invisible to GUI launches | Missing → `gh` unauthenticated |
| git identity / signing | `~/.gitconfig` (found via `HOME`), `GPG_TTY`, SSH signing keys via agent | `HOME` fallback helps config lookup only; agent + TTY vars still missing |
| `muse auth` credentials | Resolved from the user's config/home | Wrong or missing `HOME` → host itself unauthenticated |

Note the failure mode is silent divergence: commands fail *inside* the agent
turn with "permission denied" / "not authenticated" style errors while the
user's terminal works, which reads as the agent being broken rather than
unauthorized.

### 2.4 Why the other adapters are less affected (but not immune)

Claude/Codex/Gemini adapters pass `sessionEnv` into SDK/CLI spawns that merge
more forgivingly (Claude's `spawnClaudeCodeProcess` wraps `createRobustEnv`
around the provided env; Codex/Gemini CLIs inherit more of the ambient
environment). They share the same sparse-snapshot weakness, but Muse is the
strictest case because of the full-replacement semantics in §2.2 — so the
requirement is stated for Muse first, with shared helpers expected to benefit
all adapters.

## 3. Scope

### In scope

- Environment construction for the owned `muse serve` host and every shell
  tool it spawns: `PATH`/binary resolution, `HOME`/`USER`/`LOGNAME`/`SHELL`,
  SSH agent access, `gh` authentication, git identity/signing/transport, and
  user shell environment variables.
- Precedence rules between login-shell values, server process values, session
  values, and provider `additionalEnvVars`.
- Secret handling (redaction in logs, canvas, and diagnostics).
- User-visible diagnostics and actionable errors when a credential is missing.
- Automated coverage for the new behavior.

### Out of scope

- Changing the per-call `muse serve` lifecycle, MSP session/resume protocol,
  approval posture, or model selection.
- Changing git/gh/muse upstream authentication mechanisms themselves.
- Multi-user servers with mutually untrusted OS users (single-user
  local-first deployment is assumed; see Risk R-1).
- Windows parity beyond today's `createRobustEnv` behavior (POSIX-first;
  Windows follows where trivially applicable).

## 4. Functional Requirements

### 4.1 Binary resolution

| ID | Requirement |
| --- | --- |
| FR-1 | The Muse host environment MUST resolve the same binaries as the user's login shell. `muse`, `git`, `gh`, and any binary on the user's interactive `PATH` MUST be found without the user hand-configuring server `PATH` entries. |
| FR-2 | The server MUST derive the baseline `PATH` from the user's login shell (e.g. probing `$SHELL -lic` or equivalent), not only from the server launch environment plus a hardcoded dir list. Hardcoded fallback dirs MAY remain as a last resort. |
| FR-3 | Explicit user configuration MUST win: session env, provider `additionalEnvVars`, and `MUSE_BIN` keep their current precedence over derived values, and derived values MUST never reorder or drop explicit entries. |

### 4.2 Identity and home directory

| ID | Requirement |
| --- | --- |
| FR-4 | The host env MUST always carry correct `HOME`, `USER`, `LOGNAME`, and `SHELL` for the console user, so file-keyed config (`~/.config/gh/hosts.yml`, `~/.gitconfig`, `~/.ssh/config`, `muse auth` credentials) resolves exactly as in the user's terminal. Explicit values still win; fallbacks fill only gaps. |

### 4.3 Credentials: SSH, gh, git

| ID | Requirement |
| --- | --- |
| FR-5 | SSH agent access MUST work: a live, reachable `SSH_AUTH_SOCK` (and supporting agent state) from the user session MUST be propagated to the Muse host so SSH git remotes and SSH commit signing behave as in the terminal. A stale socket path that no longer accepts connections MUST be detected and reported, not silently passed through. |
| FR-6 | `gh` CLI authentication MUST work: whatever makes `gh auth status` succeed in the user's terminal (`GH_TOKEN` / `GITHUB_TOKEN`, `~/.config/gh/hosts.yml` via `HOME`, keychain-backed credential helpers) MUST be effective in the agent shell. |
| FR-7 | Git operations MUST work end to end: `git status`, commit (with the user's `user.name` / `user.email`), signed commits where the user has signing configured, and push/pull over the user's configured transport (SSH or HTTPS credential helper). |
| FR-8 | If any of FR-5–FR-7 cannot be satisfied (e.g. no agent socket, no gh token, no git identity), the agent turn MUST fail with an actionable error naming the missing piece and the remediation (e.g. "SSH agent not reachable — start ssh-agent / check SSH_AUTH_SOCK"), NOT a bare "permission denied". |

### 4.4 Environment variables

| ID | Requirement |
| --- | --- |
| FR-9 | User shell environment variables that affect tool behavior (e.g. `EDITOR`, `GPG_TTY`, `GIT_*`, provider-adjacent tokens the user exports in dotfiles) MUST be visible to the Muse host under the same names and values as in the login shell, subject to FR-10/FR-11. |
| FR-10 | Precedence MUST be, lowest to highest: login-shell-derived baseline < server process env < session env < provider `additionalEnvVars`. Cross-kind stripping in `buildSessionEnv` (e.g. removing `ANTHROPIC_*` from Muse sessions) MUST be preserved. An explicit empty string counts as a SET value for non-PATH keys (the user cleared it on purpose — explicit clear wins); only `undefined`/`null` are gaps. PATH stays special: an empty PATH is still filled, and `buildUserCredentialEnv` continues to backfill `HOME`. |
| FR-11 | Secret values (tokens, keys) MUST be redacted in all server logs, error messages surfaced to the UI/canvas, agent transcripts, and diagnostics output. Only presence/absence and origin (e.g. "GH_TOKEN: set via login shell") MAY be disclosed. |

### 4.5 Diagnostics and operability

| ID | Requirement |
| --- | --- |
| FR-12 | The server MUST expose a per-session (or provider-level) environment diagnostic showing, for each parity signal (`muse`/`git`/`gh` resolution, `HOME`, `SSH_AUTH_SOCK` reachability, `gh auth status`, git identity), whether it resolves as the user's shell does — without printing secret values. |
| FR-13 | Environment derivation MUST be resilient: if the login-shell probe fails or times out, the server MUST fall back to today's hardened snapshot behavior (`createRobustEnv` + `HOME`/`USER` fallbacks) and log the fallback with its cause, rather than failing session startup. |

## 5. User Experience

1. **Happy path (no UI change):** the user asks a Muse session to commit, push,
   or open a PR, and it just works — identical outcome to running the commands
   in their terminal.
2. **Missing credential:** instead of a cryptic tool failure deep in a turn,
   the user sees e.g.: "Muse couldn't reach your SSH agent (`SSH_AUTH_SOCK`
   not available to the server process). Run `ssh-add -l` in your terminal; if
   you launched Circus Chief from Finder/a service, relaunch it from your
   terminal or configure …". No secret values shown.
3. **Diagnostics:** a troubleshooter (API + minimal UI surface) lists each
   parity signal as pass/fail with remediation hints, so "gh works here but
   not in the agent" becomes a one-screen answer.

## 6. Acceptance Criteria

Executed from a Muse session whose server was launched in a **sparse**
environment (sanitized `PATH`, no `SSH_AUTH_SOCK`, no dotfile vars — simulating
a GUI/daemon launch):

1. `muse` binary resolves (no `MUSE_CLI_NOT_FOUND`).
2. Agent-run `git status` matches terminal output in the same worktree.
3. Agent-run `git commit` (including `-S` when the user has signing
   configured) succeeds with the user's identity.
4. Agent-run `ssh -T git@github.com` / SSH push succeeds when the terminal succeeds.
5. Agent-run `gh auth status` succeeds when the terminal succeeds, and can
   read the same repo metadata (`gh repo view`).
6. A user shell variable set in dotfiles (e.g. a test sentinel) is visible to
   agent-spawned `printenv`; a provider `additionalEnvVars` entry with the
   same name overrides it.
7. Launching with the login-shell probe disabled/broken still starts sessions
   (fallback per FR-13) and logs the cause.
8. No secret value appears in server logs, session transcripts, canvas, or
   diagnostics for any of the above runs (grep audit).
9. Existing suites pass: `MuseAdapter.test.js`, `nodeSpawnHelper.test.js`,
   `sessionProvider.test.js`, plus new tests covering FR-1–FR-13.

## 7. Implementation Notes (non-normative)

- Natural homes: extend `buildMuseHostEnv()` in
  `packages/server/src/agents/adapters/MuseAdapter.js`, generalize
  `createRobustEnv()` / `buildUserCredentialEnv()` in
  `packages/server/src/services/nodeSpawnHelper.js`, and keep
  `buildSessionEnv()` (`sessionProvider.js`) as the precedence arbiter.
  `queryParamBuilder.js` needs no shape change (still passes `env` through).
- Candidate mechanism for FR-2/FR-9: on server start (cached, short timeout),
  run the user's `$SHELL -lic 'printenv -0'` (or `~/.zprofile`-aware
  equivalent), parse NUL-delimited output, and merge allowlisted/denylisted
  keys under the FR-10 precedence. Cache per server lifetime; re-probe on
  demand from diagnostics.
- Candidate allowlist for propagation (minus denylist for `PWD`, `_`, etc.):
  `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `SSH_AUTH_SOCK`,
  `SSH_AGENT_PID`, `GH_TOKEN`, `GITHUB_TOKEN`, `GIT_*`, `GPG_*`, `GCM_*`,
  `EDITOR`, plus version-manager roots (`NVM_*`, `RBENV_*`, `CARGO_HOME`).
  Anything already set explicitly MUST NOT be overwritten.
- `SSH_AUTH_SOCK` liveness: `stat`/connect-test the socket before
  propagating; macOS launchd sockets and Linux `systemd --user` sockets need
  platform-specific handling — probe, don't assume.
- Add a `gh auth status` + `git var GIT_AUTHOR_IDENT`-style smoke check usable
  by session startup logging and the FR-12 diagnostic.
- Tests: extend `MuseAdapter.test.js` (env passed to `museClientFactory`
  contains login-shell-derived entries), `nodeSpawnHelper.test.js`
  (precedence + fallback + no-duplication invariants), and
  `sessionProvider.test.js` (cross-kind stripping preserved after merge).

## 8. Verification

1. Unit: `yarn workspace @circuschief/server test
   src/services/nodeSpawnHelper.test.js src/agents/adapters/MuseAdapter.test.js
   src/services/sessionProvider.test.js`
2. Parity script (one terminal, one agent turn, same worktree): run the
   §6 commands in both and diff outcomes.
3. Sparse-launch rehearsal: start the server with `env -i` + minimal vars and
   repeat §6; all items must still pass via the login-shell derivation.
4. Secret audit: `grep` server logs, transcript JSON, and canvas payloads for
   token values used during verification — zero hits expected.
5. Fallback rehearsal: break the shell probe (e.g. `SHELL=/bin/false`) and
   confirm sessions still start with a logged fallback.

### Round-2 acceptance re-run (2026-10-02, review findings #1–#12)

1. **Sparse launch (§6.1, finding #1): PASS.** Server `PATH` without the
   muse dir, `muse` only on the login-shell `PATH`: the CLI-version
   preflight now resolves the launcher against the derived host env (the
   same `PATH` the parity gate validated), and the turn reaches the
   `muse serve` spawn — never a raw `spawn muse ENOENT`. Preflight failures
   are mapped to the actionable `MUSE_CLI_NOT_FOUND` error.
2. **Parity spot-check (§6.2/§6.5): PASS.** `git status` and `gh auth status`
   run with the derived host env from a sparse launch matched direct
   invocation.
3. **Fallback rehearsal (§6.7/§8.5, FR-13): PASS.** `SHELL=/bin/false`:
   probe resolves `{ ok: false }`, the fallback cause is logged once
   (`[loginShellEnv]`), and `createRobustEnv` still yields a usable
   `PATH`/`HOME` so sessions start.
4. **Secret grep audit (§6.8, finding #2): PASS, extended.** A fixture
   `hosts.yml` `oauth_token` echoed in tool output, tool input, and
   assistant text reaches none of the transcript paths (`[REDACTED]`
   everywhere, zero sentinel hits). Assistant prose is scrubbed at the same
   choke point before persist AND broadcast.
5. **Integration run (finding #4): PASS.** One real turn through
   `@muse-code/sdk` + the real CLI (`MUSE_INTEGRATION=1`): spawn →
   `system(init)` → items → terminal `result` → host close (~23s). The
   suite is skipped by default where the CLI is absent.

### Endpoint exposure note (finding #8)

The diagnostics endpoint (`GET /api/agents/muse/env-diagnostics`) — like the
rest of the API — is unauthenticated while the server binds `0.0.0.0`. It
discloses only presence/absence and origin labels (no values), and
`?reprobe=1` executes `$SHELL -lic` under the shared probe budget. The
reprobe flag is parsed strictly (`1`/`true` only), and endpoint failures log
the underlying error instead of swallowing it.

## 9. Risks and Dependencies

- **R-1 (secrets in process env):** Propagating tokens into the host env puts
  more secrets in more processes. Mitigation: allowlist-only propagation,
  FR-11 redaction, and never persisting derived env to disk/DB/canvas. Residual risk (recorded, review round 2 finding #2): SSH-agent-resident keys are out of scope for value harvesting — the agent can *use* them via the socket, but the redaction set cannot contain what it cannot read; the scrub set covers secret-keyed env values plus `oauth_token` values harvested from `~/.config/gh/hosts.yml` (read once per change, held in memory only, never logged or persisted).
- **R-2 (probe cost/fragility):** Sourcing dotfiles can be slow or
  side-effectful (nvm/rbenv init). Mitigation: cache aggressively, bound the
  timeout (suggested ≤2s), run once per server lifetime, FR-13 fallback.
- **R-3 (multi-user hosts):** "Console user" heuristics (`USER`, `SUDO_USER`,
  launchd uid) can pick wrong on shared machines. Out of scope per §3, but the
  diagnostic (FR-12) must make the detected user identity visible.
- **R-4 (platform drift):** macOS launchd sockets, Linux keyrings, and
  Windows credential managers differ. Ship POSIX-first; gate platform code
  behind explicit checks with fallback + log.
- **Dependency:** `muse` CLI + `muse auth` configured for the console user;
  `gh` + git configured as in the terminal. The FRD requires *parity* with
  the terminal, not fixing a terminal that is itself unauthenticated
  (cf. §2.3 note: this machine's own `gh` token is currently invalid — the
  acceptance runs need a valid one).
