import { parkPrompt } from './promptStore.js';

export function buildInteractionCallbacks({ sessionId, conversationId }) {
  return {
    canUseTool: (toolName, input, opts = {}) => {
      const kind = toolName === 'AskUserQuestion' ? 'question' : 'permission';
      const payload = kind === 'question' ? { questions: input.questions || [], input } : {
        toolName, input, title: opts.title, displayName: opts.displayName, description: opts.description,
        blockedPath: opts.blockedPath, decisionReason: opts.decisionReason, suggestions: opts.suggestions,
      };
      return parkPrompt({ sessionId, conversationId, kind, toolUseId: opts.toolUseID, agentId: opts.agentID, payload, signal: opts.signal });
    },
    onUserDialog: async () => ({ behavior: 'cancelled' }),
    onElicitation: async () => ({ action: 'decline' }),
  };
}
