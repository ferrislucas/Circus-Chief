import { parkPrompt } from './promptStore.js';
import logger from '../logger.js';

export function buildInteractionCallbacks({ sessionId, conversationId }) {
  return {
    canUseTool: (toolName, input, opts = {}) => {
      // ExitPlanMode is the CLI's plan-approval gate (its checkPermissions
      // returns behavior:'ask' unconditionally, even under bypassPermissions).
      // Parking it as kind 'plan' lets the card render the plan instead of a
      // raw permission payload; response semantics stay allow/deny.
      const kind = toolName === 'AskUserQuestion' ? 'question'
        : toolName === 'ExitPlanMode' ? 'plan'
          : 'permission';
      const payload = kind === 'question' ? { questions: input.questions || [], input } : {
        toolName, input, title: opts.title, displayName: opts.displayName, description: opts.description,
        blockedPath: opts.blockedPath, decisionReason: opts.decisionReason, suggestions: opts.suggestions,
      };
      return parkPrompt({ sessionId, conversationId, kind, toolUseId: opts.toolUseID, agentId: opts.agentID, payload, signal: opts.signal });
    },
    onUserDialog: async (dialog = {}) => {
      logger.warn('Unsupported Claude user dialog cancelled', { sessionId, conversationId, dialogKind: dialog.dialogKind || null });
      return { behavior: 'cancelled' };
    },
    onElicitation: async () => ({ action: 'decline' }),
  };
}
