# Plan: Easy Git Worktree Creation for New Sessions

## Overview

When creating a new session, users should be able to easily elect to create a new git worktree from the project's working path. Currently, the worktree option exists but is buried in a multi-step selection process. This plan improves the UX by making worktree creation more prominent and streamlined.

## Current State

- **Session creation form** (`packages/web/src/views/NewSessionView.vue`) has:
  - Git Mode dropdown: "None", "Switch Branch", "Create Worktree"
  - Branch selection (existing or new) when git mode is selected
- **Backend** (`packages/server/src/services/gitSessionSetup.js`) already supports:
  - Automatic worktree creation at `.worktrees/{sessionId}`
  - Branch creation if it doesn't exist
- **UX Problem**: Users must select "Create Worktree" from dropdown, then manually enter a branch name - this is cumbersome for the common case of wanting quick isolation

## Proposed Solution

Add a "Quick Worktree" feature that:
1. Shows a single checkbox: "Create isolated worktree"
2. Auto-generates a sensible branch name based on session name or timestamp
3. One-click worktree creation without needing to understand git modes

## Implementation Plan

### 1. Frontend Changes (`packages/web/src/views/NewSessionView.vue`)

**Add quick worktree toggle:**
- Add a checkbox labeled "Create isolated worktree" (checked by default when git is available)
- When checked, auto-generate branch name: `vk/{shortId}-{sanitized-session-name}`
- Show the auto-generated branch name with option to customize
- Keep advanced git mode options available via "Advanced options" expandable section

**UI Layout:**
```
[x] Create isolated worktree
    Branch: vk/4a52-implement-auth  [Edit]

▸ Advanced git options (collapsed by default)
```

### 2. Branch Name Generation

**Format:** `vk/{shortId}-{slug}`
- `shortId`: First 4 characters of a new UUID
- `slug`: Sanitized session name (lowercase, hyphens, max 30 chars)
- If no session name: use first few words of prompt

**Examples:**
- Session "Implement auth" → `vk/a3f2-implement-auth`
- Session "Fix bug #123" → `vk/b4c1-fix-bug-123`
- No name, prompt "Add dark mode toggle..." → `vk/c5d2-add-dark-mode`

### 3. API Changes

**No backend changes required** - the existing `gitMode: 'worktree'` and `gitBranch` parameters handle everything. The frontend will simply:
- Set `gitMode: 'worktree'` when checkbox is checked
- Set `gitBranch` to the auto-generated (or customized) branch name

### 4. Shared Utilities (`packages/shared`)

Add branch name generation utility:
- `generateWorktreeBranch(sessionName, prompt)` → returns formatted branch name
- Can be used by both frontend (preview) and potentially backend (validation)

### 5. Files to Modify

| File | Changes |
|------|---------|
| `packages/web/src/views/NewSessionView.vue` | Add quick worktree checkbox, branch name preview, collapsible advanced options |
| `packages/shared/src/utils.js` (new) | Add `generateWorktreeBranch()` utility function |
| `packages/shared/src/index.js` | Export new utility |

### 6. UX Flow

**Before (current):**
1. Fill session name and prompt
2. Select "Create Worktree" from Git Mode dropdown
3. Type or select a branch name
4. Click Start Session

**After (proposed):**
1. Fill session name and prompt
2. Checkbox "Create isolated worktree" is pre-checked (git available)
3. See auto-generated branch name (can edit if desired)
4. Click Start Session

### 7. Edge Cases

- **Non-git project**: Hide worktree checkbox entirely
- **Branch already exists**: Show warning, suggest different name
- **Invalid characters in session name**: Sanitize automatically
- **Empty session name**: Fall back to prompt-based or random name

### 8. Testing

- Unit test for `generateWorktreeBranch()` utility
- E2E test for quick worktree creation flow
- Verify worktree is created at correct path
- Verify branch naming works with various inputs

## Summary

This change makes worktree creation a first-class, one-click experience while preserving the existing advanced options for users who need fine-grained control. The auto-generated branch names follow a consistent pattern that's easy to identify and manage.
