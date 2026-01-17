# Fix Schedule Modal Issues

## Problems

### 1. Duplicate Time Inputs
`ScheduleSessionModal.vue` displays **two** datetime inputs:
1. A required "Schedule Start Time *" at the top of the modal (lines 12-22)
2. An optional "Schedule Start Time (optional)" inside the `<SchedulingOptions>` component (lines 26-36 of SchedulingOptions.vue)

This is confusing and redundant.

### 2. Prompt Should Be Required
The "Follow-up Message" field is currently optional (line 26), but it should be **required**. When scheduling a session, we need a prompt to send when the session starts - there's no sensible default message to continue with.

## Root Cause
The `SchedulingOptions` component was designed to be a standalone, reusable component that includes scheduling time. However, when embedded in `ScheduleSessionModal`, the parent modal already provides the scheduling time input, creating duplication.

## Solutions

### Fix 1: Hide Duplicate Time Input
Add a prop to `SchedulingOptions.vue` to hide the scheduledAt input when it's not needed.

### Fix 2: Make Prompt Required
Update `ScheduleSessionModal.vue` to require the prompt field.

### Changes Required

#### 1. `SchedulingOptions.vue`
- Add a new prop: `hideScheduledAt` (Boolean, default: false)
- Wrap the "Schedule Start Time" form-group in `v-if="!hideScheduledAt"`

```vue
// Add to props
hideScheduledAt: {
  type: Boolean,
  default: false,
}

// Wrap the datetime input
<div v-if="!hideScheduledAt" class="form-group">
  <label for="scheduled-at" class="form-label">Schedule Start Time (optional)</label>
  ...
</div>
```

#### 2. `ScheduleSessionModal.vue`
**A. Pass `hideScheduledAt` prop to SchedulingOptions:**

```vue
<SchedulingOptions v-model="form.scheduling" :hide-scheduled-at="true" />
```

**B. Make prompt field required:**

Change line 26 from:
```vue
<label for="prompt" class="form-label">Follow-up Message (optional)</label>
```

To:
```vue
<label for="prompt" class="form-label">Follow-up Message *</label>
```

Add `required` attribute to the textarea (line 27-33):
```vue
<textarea
  id="prompt"
  v-model="form.prompt"
  class="form-input"
  rows="3"
  placeholder="Enter a message to send when the session starts..."
  required
></textarea>
```

Remove the help text (line 34) or change it to:
```vue
<p class="form-help">This message will be sent when the scheduled session starts</p>
```

Update validation in `isValid` computed (line 89-93):
```vue
const isValid = computed(() => {
  if (!form.scheduledAtLocal) return false;
  if (!form.prompt || !form.prompt.trim()) return false; // Add this line
  const scheduledTime = new Date(form.scheduledAtLocal).getTime();
  return scheduledTime > Date.now();
});
```

Remove the conditional prompt inclusion in `handleSchedule` (lines 111-114):
```vue
const payload = {
  scheduledAt,
  prompt: form.prompt.trim(), // Always include, no longer conditional
  ...form.scheduling,
};
```

## Testing

### Test Fix 1: Duplicate Time Input
1. Open the "Schedule Session" modal from a completed session
2. Verify only ONE datetime input appears (the required one at the top)
3. Expand "Scheduling Options" - verify no duplicate time input inside
4. Verify `SchedulingOptions` still shows the time input when used standalone (e.g., in NewSessionView if applicable)

### Test Fix 2: Required Prompt
1. Open the "Schedule Session" modal
2. Verify the label shows "Follow-up Message *" (with asterisk)
3. Select a schedule time but leave the message field empty
4. Verify the "Schedule" button is disabled
5. Type a message in the prompt field
6. Verify the "Schedule" button becomes enabled
7. Click "Schedule" and verify the session is scheduled with the prompt

## Files to Modify
- `packages/web/src/components/SchedulingOptions.vue`
- `packages/web/src/components/ScheduleSessionModal.vue`
