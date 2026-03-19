# Plan: Inherit Rescheduling Properties in Template-Triggered Sessions

## Problem

When `templateTriggerService.js` creates a child session from a template, it inherits some parent properties (`thinkingEnabled`, `gitBranch`, `model`, `mode`) but **not** the rescheduling properties. The child gets database defaults (all `false`/`null`), silently breaking rescheduling in template chains.

## Root Cause

`templateTriggerService.js` lines 103-132 — the inheritance block and `sessions.create()` / `sessions.update()` calls don't include any rescheduling fields.

## Changes

### 1. `packages/server/src/services/templateTriggerService.js`

After the existing inheritance block (lines 103-108), add inheritance for rescheduling properties from the parent session:

```javascript
// Inherit rescheduling settings from parent session
const autoRescheduleEnabled = session.autoRescheduleEnabled;
const rescheduleOnTokenLimit = session.rescheduleOnTokenLimit;
const rescheduleOnServiceError = session.rescheduleOnServiceError;
const rescheduleDelayMinutes = session.rescheduleDelayMinutes;
const rescheduleAtTokenCount = session.rescheduleAtTokenCount;
const maxRescheduleCount = session.maxRescheduleCount;
```

Then pass them in the `sessions.update()` call (lines 129-132) alongside `parentSessionId` and `nextTemplateId`:

```javascript
sessions.update(newSession.id, {
  parentSessionId: session.id,
  nextTemplateId: template.nextTemplateId || null,
  autoRescheduleEnabled,
  rescheduleOnTokenLimit,
  rescheduleOnServiceError,
  rescheduleDelayMinutes,
  rescheduleAtTokenCount,
  maxRescheduleCount,
});
```

### 2. `packages/server/src/services/templateTriggerService.test.js`

Add a test case verifying that rescheduling properties are inherited from the parent session when a template triggers a child session. Mock a parent session with rescheduling enabled and assert the child session's `sessions.update()` call includes those fields.

## Fields to Inherit

| Field | DB Default | Description |
|-------|-----------|-------------|
| `autoRescheduleEnabled` | `false` | Master switch for all rescheduling |
| `rescheduleOnTokenLimit` | `false` | Reschedule on token/quota errors |
| `rescheduleOnServiceError` | `false` | Reschedule on 503/overloaded errors |
| `rescheduleDelayMinutes` | `null` | Delay before rescheduling |
| `rescheduleAtTokenCount` | `null` | Proactive reschedule at token threshold |
| `maxRescheduleCount` | `null` | Max number of reschedules allowed |

## Scope

- **2 files** modified
- No database migration needed (columns already exist)
- No API changes needed
- No frontend changes needed
