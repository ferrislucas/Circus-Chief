/**
 * Pure helpers for applying a template to an existing session's input form.
 *
 * These are deliberately framework-free so the trickier logic (prompt
 * appending/dedup and which session fields a template touches) can be unit
 * tested without mounting ConversationTab.
 */

/**
 * Append a template prompt to the current input value.
 *
 * Returns the new combined value, or `null` when nothing should change
 * (empty prompt, or the prompt is already present at the end of the input so
 * re-selecting the same template doesn't duplicate it).
 *
 * @param {string} currentValue - The current textarea value.
 * @param {string} prompt - The template prompt to append.
 * @returns {string|null} The new value, or null if no change is needed.
 */
export function appendTemplatePromptValue(currentValue, prompt) {
  const trimmedPrompt = (prompt ?? '').trim();
  if (!trimmedPrompt) return null;

  const trimmedCurrent = (currentValue ?? '').trim();
  if (trimmedCurrent.endsWith(trimmedPrompt)) return null;

  return trimmedCurrent ? `${trimmedCurrent}\n\n${trimmedPrompt}` : trimmedPrompt;
}

/**
 * Build the batch of session fields a template should apply to an existing
 * session. Git mode/branch and nextTemplateId are intentionally excluded -
 * those are not editable on an existing session and chaining is a separate
 * feature. Model/provider are handled separately because they flow through the
 * ModelSelector refs.
 *
 * @param {Object} template - The template object.
 * @returns {{mode?: string, thinkingEnabled?: boolean, effortLevel?: string}}
 */
export function buildTemplateSettingsFields(template) {
  const fields = {};
  if (!template) return fields;
  if (template.mode) fields.mode = template.mode;
  if (template.thinkingEnabled != null) fields.thinkingEnabled = template.thinkingEnabled;
  if (template.effortLevel != null) fields.effortLevel = template.effortLevel;
  return fields;
}
