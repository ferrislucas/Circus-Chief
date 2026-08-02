import { randomUUID } from 'crypto';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { createWorkLog } from './workLogService.js';

const prompts = new Map();

function project(record) {
  const { resolve: _resolve, reject: _reject, abortListener: _abortListener, signal: _signal, ...wire } = record;
  return wire;
}

function settle(record, outcome, result) {
  if (prompts.get(record.sessionId)?.id !== record.id) return false;
  prompts.delete(record.sessionId);
  record.signal?.removeEventListener('abort', record.abortListener);
  const { toolName, content } = describePromptOutcome(record, outcome, result);
  createWorkLog(record.sessionId, 'tool_output', content, toolName);
  broadcastToSession(record.sessionId, WS_MESSAGE_TYPES.SESSION_PROMPT_RESOLVED, {
    sessionId: record.sessionId, promptId: record.id, outcome,
  });
  record.resolve(result);
  return true;
}

export function describePromptOutcome(record, outcome, result) {
  if (record.kind === 'question') {
    if (outcome === 'answer') {
      const answers = Object.entries(result.updatedInput?.answers || {})
        .map(([question, answer]) => `${question}: ${answer}`)
        .join('\n');
      return { toolName: 'AskUserQuestion', content: `User answered:\n${answers}` };
    }
    return { toolName: 'AskUserQuestion', content: `User did not answer: ${result.message}` };
  }

  const toolName = record.payload.toolName || 'Unknown tool';
  const outcomeText = {
    allow: 'allowed once',
    always: 'always allowed',
    deny: 'denied',
    superseded: 'superseded',
    cancelled: 'cancelled',
  }[outcome] || outcome;
  const reason = result.message ? `: ${result.message}` : '';
  return { toolName, content: `User ${outcomeText} ${toolName}${reason}` };
}

export function parkPrompt({ sessionId, conversationId, kind, toolUseId = null, agentId = null, payload, signal }) {
  const questions = payload.questions || [];
  if (kind === 'question' && new Set(questions.map(({ question }) => question)).size !== questions.length) {
    return Promise.resolve({ behavior: 'deny', message: 'Please re-ask using distinct question text.' });
  }
  const existing = prompts.get(sessionId);
  if (existing) settle(existing, 'superseded', { behavior: 'deny', message: 'This interaction was superseded.' });
  return new Promise((resolve, reject) => {
    const record = { id: randomUUID(), sessionId, conversationId, kind, toolUseId, agentId, payload,
      createdAt: Date.now(), resolve, reject, signal, abortListener: null };
    record.abortListener = () => settle(record, 'cancelled', { behavior: 'deny', message: 'Session was cancelled.' });
    signal?.addEventListener('abort', record.abortListener, { once: true });
    prompts.set(sessionId, record);
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PROMPT, { sessionId, prompt: project(record) });
  });
}

export function getPrompt(sessionId) { const record = prompts.get(sessionId); return record ? project(record) : null; }
export function hasPendingPrompt(sessionId) { return prompts.has(sessionId); }
export function cancelPrompt(sessionId, reason = 'Session was cancelled.') {
  const record = prompts.get(sessionId);
  return record ? settle(record, 'cancelled', { behavior: 'deny', message: reason }) : false;
}
function questionResult(record, response) {
  return response.action === 'answer'
    ? { behavior: 'allow', updatedInput: { ...record.payload.input, answers: response.answers || {}, ...(response.annotations ? { annotations: response.annotations } : {}), ...(response.response ? { response: response.response } : {}) } }
    : { behavior: 'deny', message: response.reason || 'Proceed on your best judgment and state your assumption.' };
}

function permissionResult(record, response) {
  if (response.action === 'allow') return { behavior: 'allow' };
  if (response.action === 'always' && Array.isArray(record.payload.suggestions) && record.payload.suggestions.length) {
    return {
      behavior: 'allow',
      updatedPermissions: record.payload.suggestions.map((suggestion) => ({
        ...suggestion,
        destination: response.destination || 'session',
      })),
    };
  }
  return { behavior: 'deny', message: response.reason || 'Permission denied by user.' };
}

export function respondToPrompt(sessionId, promptId, response) {
  const record = prompts.get(sessionId);
  if (!record || record.id !== promptId) return false;
  const result = record.kind === 'question' ? questionResult(record, response) : permissionResult(record, response);
  return settle(record, response.action, result);
}
