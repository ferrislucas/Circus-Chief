/**
 * Workflow fingerprinting for session summary staleness detection.
 *
 * Computes a stable SHA-256 fingerprint that captures the full state of a
 * session's workflow tree: own message metadata plus the message metadata,
 * summary metadata, and summary content of every descendant.
 */

import crypto from 'crypto';
import { sessions, messages, sessionSummaries } from '../database.js';

/**
 * Serialize an object to JSON with keys sorted at every level for stability.
 * Does NOT rely on any third-party library.
 * @param {*} value
 * @returns {string}
 */
function stableJson(value) {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableJson).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const pairs = keys.map((k) => JSON.stringify(k) + ':' + stableJson(value[k]));
    return '{' + pairs.join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * Compute a SHA-256 hex hash of the semantic content fields of a summary.
 * Timestamps and IDs are deliberately excluded so that a re-generated summary
 * with the same text produces the same hash.
 * @param {Object} summary
 * @returns {string}
 */
function computeContentHash(summary) {
  const content = {
    shortSummary: summary.shortSummary || '',
    fullSummary: summary.fullSummary || '',
    keyActions: Array.isArray(summary.keyActions) ? summary.keyActions : [],
    filesModified: Array.isArray(summary.filesModified) ? summary.filesModified : [],
    outcome: summary.outcome || '',
    prState: summary.prState || null,
    hasMergeConflicts: summary.hasMergeConflicts ?? null,
    ciStatus: summary.ciStatus || null,
    ciFailures: Array.isArray(summary.ciFailures) ? summary.ciFailures : [],
  };
  return crypto.createHash('sha256').update(stableJson(content)).digest('hex');
}

/**
 * Collect all descendant sessions in breadth-first, creation-time order.
 * Children at each level are sorted by `createdAt` (then by `id` as a tie-
 * breaker so the result is fully deterministic even with millisecond precision
 * collisions).
 *
 * @param {string} sessionId - Root session whose descendants to collect.
 * @returns {Array} All descendant session objects, in tree-path BFS order.
 */
function getDescendantsInTreeOrder(sessionId) {
  const result = [];
  const queue = [sessionId];

  while (queue.length > 0) {
    const current = queue.shift();
    const children = sessions.getChildSessions(current);

    // Sort deterministically: earliest created first, then by ID as tie-breaker
    const sorted = children.slice().sort((a, b) => {
      const timeDiff = a.createdAt - b.createdAt;
      if (timeDiff !== 0) return timeDiff;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    for (const child of sorted) {
      result.push(child);
      queue.push(child.id);
    }
  }

  return result;
}

/**
 * Compute a stable workflow fingerprint for a session.
 *
 * The fingerprint captures:
 *   - Own session: message count and last message ID
 *   - Every descendant: message metadata + summary metadata + content hash
 *
 * Any change to message counts, summary content, or the set of descendants
 * will produce a different fingerprint, making it safe to use for staleness
 * detection even when timestamps cannot be trusted.
 *
 * All underlying operations use the synchronous better-sqlite3 driver.
 * The function signature is synchronous for that reason — callers that
 * previously awaited it can continue to do so (awaiting a non-Promise
 * value is a no-op).
 *
 * @param {string} sessionId - The root session ID.
 * @returns {string} SHA-256 hex fingerprint string.
 */
export function computeWorkflowFingerprint(sessionId) {
  // Own session message metadata
  const ownMessages = messages.getBySessionId(sessionId);
  const lastOwnMessage = ownMessages.length > 0 ? ownMessages[ownMessages.length - 1] : null;

  const ownData = {
    sessionId,
    messageCount: ownMessages.length,
    lastMessageId: lastOwnMessage ? lastOwnMessage.id : null,
  };

  // All descendants in deterministic tree order
  const descendants = getDescendantsInTreeOrder(sessionId);

  const descendantData = descendants.map((desc) => {
    const descMessages = messages.getBySessionId(desc.id);
    const lastDescMsg = descMessages.length > 0 ? descMessages[descMessages.length - 1] : null;
    const descSummary = sessionSummaries.getBySessionId(desc.id);

    return {
      sessionId: desc.id,
      parentSessionId: desc.parentSessionId,
      status: desc.status,
      messageCount: descMessages.length,
      lastMessageId: lastDescMsg ? lastDescMsg.id : null,
      summaryId: descSummary ? descSummary.id : null,
      generatedAt: descSummary ? descSummary.generatedAt : null,
      updatedAt: descSummary ? descSummary.updatedAt : null,
      summaryMessageCount: descSummary ? descSummary.messageCount : null,
      lastSummarizedMessageId: descSummary ? descSummary.lastSummarizedMessageId : null,
      contentHash: descSummary ? computeContentHash(descSummary) : null,
    };
  });

  const fingerprint = {
    own: ownData,
    descendants: descendantData,
  };

  return crypto.createHash('sha256').update(stableJson(fingerprint)).digest('hex');
}
