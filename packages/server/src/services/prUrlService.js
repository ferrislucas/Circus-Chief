/**
 * PR URL extraction, parsing, validation, and enrichment.
 * Consolidates all PR-related functionality from summaryService.
 */

import { sessions, messages } from '../database.js';
import { broadcastSessionUpdate } from './summaryBroadcast.js';
import * as ghService from './ghService.js';

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
      console.warn(`[PrUrlService] Invalid PR URL format: ${prUrl}`);
      return null;
    }

    return {
      owner: match[1],
      repo: match[2],
      number: parseInt(match[3], 10),
    };
  } catch (error) {
    console.warn(`[PrUrlService] Failed to parse PR URL ${prUrl}:`, error.message);
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
    console.warn(`[PrUrlService] No expected repo URL to validate against PR: ${prUrl}`);
    return { valid: true, prComponents, mismatch: false, error: null };
  }

  // Extract owner/repo from expected repo URL
  const expectedMatch = expectedRepoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (!expectedMatch) {
    console.warn(`[PrUrlService] Invalid expected repo URL format: ${expectedRepoUrl}`);
    return { valid: true, prComponents, mismatch: false, error: null };
  }

  const expectedOwner = expectedMatch[1];
  const expectedRepo = expectedMatch[2];

  // Validate that the PR belongs to the expected repository
  const ownerMatch = prComponents.owner === expectedOwner;
  const repoMatch = prComponents.repo === expectedRepo;

  if (!ownerMatch || !repoMatch) {
    console.warn(
      `[PrUrlService] PR repository mismatch: ` +
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

/**
 * Extract PR URL from session messages by scanning for GitHub PR links
 * @param {string} sessionId - The session ID
 * @returns {string|null} - The PR URL if found, null otherwise
 */
export function extractPrUrlFromMessages(sessionId) {
  const allMessages = messages.getBySessionId(sessionId);
  if (!allMessages || allMessages.length === 0) return null;

  // Get recent messages (last 20) to scan for PR URLs
  const recentMessages = allMessages.slice(-20);

  // GitHub PR URL pattern: https://github.com/{owner}/{repo}/pull/{number}
  const prUrlPattern = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/g;

  // Scan messages in reverse order (most recent first) to find the latest PR URL
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const message = recentMessages[i];
    const matches = message.content?.match(prUrlPattern);

    if (matches && matches.length > 0) {
      // Return the most recent PR URL found
      return matches[matches.length - 1];
    }
  }

  return null;
}

/**
 * Extract PR URL from recent messages immediately after a turn completes.
 * This is lightweight (no Claude API call) - just scans messages for URLs.
 * @param {string} sessionId - The session ID
 */
export async function extractPrUrlIfNeeded(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session) return;

  // Skip if session already has a PR URL
  if (session.prUrl) return;

  // Extract PR URL from messages
  const prUrl = extractPrUrlFromMessages(sessionId);
  if (prUrl) {
    sessions.update(sessionId, { prUrl });
    console.log(`[PrUrlService] Extracted PR URL for session ${sessionId}: ${prUrl}`);

    // Broadcast session update so UI shows PR URL immediately
    broadcastSessionUpdate(sessionId, session.projectId, sessions.getById(sessionId));

    // Propagate PR URL to root session
    if (session.parentSessionId) {
      const rootId = sessions.getRootSessionId(sessionId);
      if (rootId && rootId !== sessionId) {
        const root = sessions.getById(rootId);
        if (root && !root.prUrl) {
          sessions.update(root.id, { prUrl });
          console.log(`[PrUrlService] Propagated PR URL from session ${sessionId} to root ${root.id}: ${prUrl}`);

          // Broadcast root session update
          broadcastSessionUpdate(root.id, root.projectId, sessions.getById(root.id));
        }
      }
    }
  }
}

/**
 * Validate and enrich PR URL data with GitHub PR status information
 * @param {Object} summaryData - Summary data to enrich (modified in place)
 * @param {string} prUrl - PR URL to validate and enrich
 * @param {string} projectRepoUrl - Expected repository URL for validation
 * @param {string} sessionId - Session ID for logging
 */
export async function enrichPrData(summaryData, prUrl, projectRepoUrl, sessionId) {
  const validation = validatePrUrl(prUrl, projectRepoUrl);

  if (!validation.valid) {
    console.warn(`[PrUrlService] PR URL validation failed for session ${sessionId}:`, validation.error);
    summaryData.prUrl = null;
    return;
  }

  try {
    const prInfo = await ghService.getPrInfo(prUrl);
    if (prInfo) {
      summaryData.prState = prInfo.state;
      summaryData.prMerged = prInfo.merged;
      summaryData.hasMergeConflicts = prInfo.hasMergeConflicts;
      summaryData.ciStatus = prInfo.ciStatus;
      if (prInfo.ciFailures !== undefined) {
        summaryData.ciFailures = prInfo.ciFailures;
      }
    }
  } catch (error) {
    console.warn(`[PrUrlService] Failed to get PR info for ${prUrl}:`, error.message);
  }
}

// Backward-compatible alias for internal/test usage
export { enrichPrData as _enrichPrData };
