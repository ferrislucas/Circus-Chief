/**
 * Pure helpers for applying a template to an existing session's input form.
 *
 * These are deliberately framework-free so the trickier logic (prompt
 * appending/dedup and which session fields a template touches) can be unit
 * tested without mounting ConversationTab.
 */

import { isTierRef } from '@circuschief/shared';

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

/**
 * Resolve which provider id a template model should persist with.
 *
 * Keeps the (model, providerId) pair atomic: tier refs are provider-less,
 * an explicit providerId key (including null) is honored, and a missing key
 * resolves the owning provider from the catalog — never the session's
 * current selection, which may belong to a different provider.
 * Returns null when no owner can be determined.
 *
 * @param {Object} template - The template object.
 * @param {Array} providers - Provider catalog entries ({ id, isBuiltIn, kind, models: [{ modelId }] }).
 * @returns {string|null} The provider id to persist, or null.
 */
export function resolveTemplateProviderId(template, providers = []) {
  if (!template || !template.model) return null;
  if (isTierRef(template.model)) return null;
  if (Object.prototype.hasOwnProperty.call(template, 'providerId')) {
    return template.providerId ?? null;
  }
  const owner = (providers || []).find((provider) =>
    (provider.models || []).some((model) => model.modelId === template.model)
  );
  if (owner) return owner.id;
  const kind = template.model.startsWith('gpt-') ? 'openai'
    : template.model.startsWith('gemini-') ? 'google'
      : template.model.startsWith('claude-') ? 'anthropic'
        : null;
  return (providers || []).find(
    (provider) => provider.isBuiltIn && provider.kind === kind
  )?.id || null;
}
