import { DEFAULT_TOKEN_COST_WEIGHTS } from './constants.js';

/**
 * Generate a short random ID (4 hex characters)
 * @returns {string}
 */
export function generateShortId() {
  return Math.random().toString(16).substring(2, 6);
}

/**
 * Calculate Billable Token Equivalent (BTE) - a cost-weighted token score
 * @param {Object} usage - Token usage object
 * @param {number} [usage.inputTokens] - Number of input tokens
 * @param {number} [usage.outputTokens] - Number of output tokens
 * @param {number} [usage.cacheReadInputTokens] - Number of cache read tokens
 * @param {number} [usage.cacheCreationInputTokens] - Number of cache creation tokens
 * @param {Object} [weights] - Custom weights (defaults to DEFAULT_TOKEN_COST_WEIGHTS)
 * @returns {number} The calculated BTE score
 */
export function calculateBillableTokens(usage, weights = DEFAULT_TOKEN_COST_WEIGHTS) {
  if (!usage) return 0;
  return Math.round(
    (usage.inputTokens || 0) * weights.input +
    (usage.outputTokens || 0) * weights.output +
    (usage.cacheReadInputTokens || 0) * weights.cacheRead +
    (usage.cacheCreationInputTokens || 0) * weights.cacheCreation
  );
}

/**
 * Format a token count for display (e.g., 1234 → "1.2K", 1234567 → "1.2M")
 * @param {number} n - The token count
 * @returns {string} Formatted string
 */
export function formatTokenCount(n) {
  if (!n || n === 0) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/**
 * Sanitize a string for use in a git branch name
 * @param {string} text - The text to sanitize
 * @param {number} [maxLength=30] - Maximum length of the result
 * @returns {string}
 */
export function sanitizeBranchName(text, maxLength = 30) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Trim leading/trailing hyphens
    .substring(0, maxLength);
}

/**
 * Extract a slug from a prompt (first few meaningful words)
 * @param {string} prompt - The prompt text
 * @returns {string}
 */
export function extractSlugFromPrompt(prompt) {
  // Take first 5 words, filter out common stop words
  const stopWords = ['a', 'an', 'the', 'to', 'and', 'or', 'for', 'in', 'on', 'at', 'of', 'with', 'is', 'it', 'this', 'that', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'can', 'please', 'help'];
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !stopWords.includes(word))
    .slice(0, 4);

  return words.join('-') || 'session';
}

/**
 * Generate a git branch name for a worktree
 * @param {string} [sessionName] - Optional session name
 * @param {string} [prompt] - Optional prompt to extract slug from
 * @returns {string} Branch name in format: claude-tools/{shortId}-{slug}
 */
export function generateWorktreeBranch(sessionName, prompt) {
  const shortId = generateShortId();

  let slug;
  if (sessionName && sessionName.trim()) {
    slug = sanitizeBranchName(sessionName.trim());
  } else if (prompt && prompt.trim()) {
    slug = sanitizeBranchName(extractSlugFromPrompt(prompt.trim()));
  } else {
    slug = 'session';
  }

  // Ensure slug is not empty
  if (!slug) {
    slug = 'session';
  }

  return `claude-tools/${shortId}-${slug}`;
}
