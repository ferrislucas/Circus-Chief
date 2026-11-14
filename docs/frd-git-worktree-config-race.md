# FRD: Reliable Git Worktree Configuration

## Problem

Starting a worktree session can fail before its agent starts when two sessions
in the same repository run Git configuration at the same time. Git creates the
repository-wide `.git/config.lock` while executing:

```sh
git config extensions.worktreeConfig true
```

Circus Chief currently runs that command during worktree setup and again while
installing the managed commit-attribution hook. The hook setup is also repeated
on several session/continuation paths. A collision makes the child lane session
fail with zero agent tokens, while its workspace root can remain `waiting` and
the Kanban card can remain in its prior lane without a visible failure.

`extensions.worktreeConfig` is required once per repository so that Git permits
`git config --worktree`. The per-worktree settings preserve the developer's
author identity and install Circus Chief's managed `commit-msg` hook without
changing other worktrees.

## Goals

1. Concurrent session starts in the same repository must not fail because of a
   Circus Chief-initiated Git configuration lock collision.
2. The shared `extensions.worktreeConfig` migration must be performed only when
   necessary, once per repository.
3. Worktree-specific author and hook configuration must continue to work.
4. A startup failure that still occurs must be visible on the workspace/root
   session and actionable from the Kanban workflow.

## Functional Requirements

### Repository-level worktree-config initialization

- Introduce one shared operation that ensures
  `extensions.worktreeConfig` is enabled for the repository containing a
  worktree.
- Read the effective value first. If it is already `true`, do not issue a
  config write.
- Serialize this operation per canonical repository/common Git directory in a
  single Circus Chief server process. Different repositories must remain able
  to initialize concurrently.
- While initializing, re-check the value after acquiring the per-repository
  lock so that queued callers do not rewrite config.
- Do not make the in-memory lock depend solely on a worktree path; multiple
  worktrees for one repository must share it.
- If Git reports a transient `config.lock` collision from an external Git
  process or another server process, retry the idempotent initialization with a
  short bounded backoff. Before each retry, re-read the value and succeed if it
  is already enabled.
- If the lock remains unavailable after the retry limit, return a clear,
  classified error identifying the repository and the shared-config
  contention. Never delete a Git lock file automatically.

### Call-site consolidation

- `pinAuthorInWorktree`, `ensureWorktreeCommitAttributionHook`, and
  `clearWorktreeCommitAttribution` must use the shared ensure operation rather
  than directly executing `git config extensions.worktreeConfig true`.
- Session creation, initial execution, continuation, retry, and model-switch
  paths may invoke the idempotent ensure operation safely, but must not each
  independently write the shared configuration.
- Once worktree config is enabled, author identity and `core.hooksPath` must
  be written only with `git config --worktree`.
- Existing behavior that refuses to overwrite a user-managed `core.hooksPath`
  must remain unchanged.

### Failure propagation and workflow behavior

- A worktree-startup failure must mark the child session as failed and expose
  its error on the workspace/root session's status or workflow summary.
- For Kanban lane automation, the card must show that the lane-run failed and
  display the child-session failure reason without requiring users to inspect
  server logs.
- Do not leave an automated workspace silently `waiting` in a review lane when
  its required child session failed before launch.
- Preserve the failed lane run for diagnosis; do not automatically rerun or
  move the card unless existing retry/routing policy explicitly directs it.

## Non-Goals

- Coordinating arbitrary external Git operations beyond bounded retry.
- Deleting or forcibly breaking `.git/config.lock` files.
- Changing commit author attribution, hook contents, or user-managed hook
  ownership rules.
- Automatically rerunning a failed PR review without an explicit workflow
  policy.

## Acceptance Criteria

1. Two or more simultaneous worktree session starts for one repository
   complete their setup without a `could not lock config file` failure caused
   by Circus Chief.
2. With `extensions.worktreeConfig` already enabled, session setup performs no
   shared `.git/config` write for that setting.
3. A fresh repository enables the setting once, then successfully writes
   per-worktree author identity and managed hook settings.
4. An externally held config lock is retried within the configured bounded
   window; if it clears, setup succeeds.
5. A lock that does not clear produces a classified, human-readable startup
   error and leaves the lock file untouched.
6. A Kanban-created child session that fails at worktree setup makes the parent
   workspace/card visibly failed or attention-required, including the reason.
7. Existing tests for author pinning, managed-hook installation, custom hook
   protection, session startup, continuations, and Kanban automation continue
   to pass; add concurrency and failure-propagation coverage for this change.

## Implementation Notes

The likely seam is a new Git-service helper backed by a repository-keyed
promise/mutex, used by the existing attribution and author helpers. The retry
logic should recognize Git's config-lock error specifically, rather than
retrying unrelated configuration failures. The workflow/UI portion should use
the lane-run's terminal child-session failure as the source of truth and make
that state visible at the workspace-card level.
