/**
 * PR URL Extractor
 * Regex-scans messages for GitHub PR URLs, broadcasts when found
 */

import { sessions, messages } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

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
    console.log(`[SummaryService] Extracted PR URL for session ${sessionId}: ${prUrl}`);

    // Broadcast session update so UI shows PR URL immediately
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      sessionId,
      session: sessions.getById(sessionId),
    });

    // Also broadcast to project subscribers
    if (session.projectId) {
      broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
        projectId: session.projectId,
        sessionId,
        session: sessions.getById(sessionId),
      });
    }
  }
}
