import {
  sessions,
  conversations,
  messages,
  canvasItems,
  sessionNotes,
  sessionSummaries,
  projects,
} from '../db/index.js';

/**
 * Duplicates a session including all related data.
 * Handles git setup based on the source session's configuration.
 *
 * @param {string} sourceSessionId - ID of session to duplicate
 * @param {object} options - Duplication options
 * @param {string} [options.name] - Custom name for new session
 * @returns {Promise<object>} The new session with all data duplicated
 */
export async function duplicateSession(sourceSessionId, options = {}) {
  // 1. Get source session and project
  const sourceSession = sessions.getById(sourceSessionId);
  if (!sourceSession) {
    throw new Error(`Session not found: ${sourceSessionId}`);
  }

  const project = projects.getById(sourceSession.projectId);
  if (!project) {
    throw new Error(`Project not found: ${sourceSession.projectId}`);
  }

  // 2. Duplicate session record (without git worktree path)
  const newSession = sessions.duplicate(sourceSessionId, {
    name: options.name,
  });

  try {
    // 3. Duplicate conversations and get ID mapping
    const conversationMapping = conversations.duplicateForSession(
      sourceSessionId,
      newSession.id
    );

    // 4. Duplicate messages using conversation mapping
    messages.duplicateForConversations(conversationMapping, newSession.id);

    // 5. Duplicate canvas items
    canvasItems.duplicateForSession(sourceSessionId, newSession.id);

    // 6. Duplicate session notes
    sessionNotes.duplicateForSession(sourceSessionId, newSession.id);

    // 7. Duplicate session summary (if exists)
    sessionSummaries.duplicateForSession(sourceSessionId, newSession.id);

    // Return the updated session
    return sessions.getById(newSession.id);
  } catch (error) {
    // Cleanup: delete the new session if duplication fails
    sessions.delete(newSession.id);
    throw error;
  }
}
