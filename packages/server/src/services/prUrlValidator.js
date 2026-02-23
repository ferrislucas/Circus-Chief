/**
 * PR URL Validator
 * URL parsing into owner/repo/number, cross-validation against project repo
 */

/**
 * Parse a GitHub PR URL into components
 * @param {string} prUrl - GitHub PR URL
 * @returns {Object|null} - { owner, repo, number } or null if invalid format
 */
export function parsePrUrl(prUrl) {
  if (!prUrl) return null;

  try {
    // Match GitHub PR URL pattern: https://github.com/{owner}/{repo}/pull/{number}
    const match = prUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
    if (!match) {
      console.warn(`[SummaryService] Invalid PR URL format: ${prUrl}`);
      return null;
    }

    return {
      owner: match[1],
      repo: match[2],
      number: parseInt(match[3], 10),
    };
  } catch (error) {
    console.warn(`[SummaryService] Failed to parse PR URL ${prUrl}:`, error.message);
    return null;
  }
}

/**
 * Validate that a PR URL belongs to the expected repository
 * @param {string} prUrl - GitHub PR URL
 * @param {string} expectedRepoUrl - Expected repository URL
 * @returns {Object} - { valid: boolean, prComponents: Object|null, mismatch: boolean, error: string|null }
 */
export function validatePrUrl(prUrl, expectedRepoUrl) {
  if (!prUrl) {
    return { valid: false, prComponents: null, mismatch: false, error: 'No PR URL provided' };
  }

  // Parse the PR URL
  const prComponents = parsePrUrl(prUrl);
  if (!prComponents) {
    return { valid: false, prComponents: null, mismatch: false, error: 'Invalid PR URL format' };
  }

  // If no expected repo URL, we can't validate the match - accept it but log a warning
  if (!expectedRepoUrl) {
    console.warn(`[SummaryService] No expected repo URL to validate against PR: ${prUrl}`);
    return { valid: true, prComponents, mismatch: false, error: null };
  }

  // Extract owner/repo from expected repo URL
  const expectedMatch = expectedRepoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (!expectedMatch) {
    console.warn(`[SummaryService] Invalid expected repo URL format: ${expectedRepoUrl}`);
    return { valid: true, prComponents, mismatch: false, error: null };
  }

  const expectedOwner = expectedMatch[1];
  const expectedRepo = expectedMatch[2];

  // Validate that the PR belongs to the expected repository
  const ownerMatch = prComponents.owner === expectedOwner;
  const repoMatch = prComponents.repo === expectedRepo;

  if (!ownerMatch || !repoMatch) {
    console.warn(
      `[SummaryService] PR repository mismatch: ` +
      `PR is from ${prComponents.owner}/${prComponents.repo}, ` +
      `but expected ${expectedOwner}/${expectedRepo}`
    );
    return {
      valid: false,
      prComponents,
      mismatch: true,
      error: `PR from ${prComponents.owner}/${prComponents.repo} does not match expected ${expectedOwner}/${expectedRepo}`
    };
  }

  return { valid: true, prComponents, mismatch: false, error: null };
}
