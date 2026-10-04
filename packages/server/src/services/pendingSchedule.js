/**
 * Fields that exist only while a scheduled launch is still pending.
 *
 * Trusted schedule provenance is intentionally included: it authorizes the
 * one claimed launch, never a later durable session state.
 */
export const clearedPendingSchedule = Object.freeze({
  scheduledAt: null,
  pendingPrompt: null,
  pendingConversationId: null,
  pendingModel: null,
  pendingInteractive: null,
});
