/**
 * Compose a CLI prompt by prepending the system prompt (if provided) to the
 * user prompt. Used by both Codex and Gemini CLI runners.
 *
 * @param {string|null} systemPrompt
 * @param {string|null} prompt
 * @returns {string}
 */
export function composeCliPrompt(systemPrompt, prompt) {
  const user = prompt ?? '';
  if (typeof systemPrompt === 'string' && systemPrompt.length > 0) {
    return `SYSTEM PROMPT:\n${systemPrompt}\n\nUSER:\n${user}`;
  }
  return user;
}
