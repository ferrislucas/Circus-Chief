import { randomUUID } from 'crypto';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { createWorkLog } from './workLogService.js';
import { sessions } from '../database.js';
import { PROMPT_ACTIONS_BY_KIND } from '@circuschief/shared/contracts/prompts';
import { buildSafeToolInputSummary, buildSafeHeadline, buildSafeBlockedPath } from './promptDurableSummary.js';
import logger from '../logger.js';

// Sessions hold an *ordered queue* of parked prompts, not a single record.
//
// Why: the SDK dispatches `can_use_tool` control requests concurrently, not
// serially — `processPendingPermissionRequests` in the SDK fires every
// pending request without awaiting the previous one, and parallel `tool_use`
// blocks in a single assistant message are routine. Treating a second
// arrival as "supersedes the first" (the original design) silently
// auto-denies the first tool call the moment the model does two things at
// once. Only the head of the queue is ever surfaced to the client; later
// arrivals wait their turn and are promoted to head as earlier ones resolve.
const prompts = new Map();
const CANCELLED_MESSAGE = 'Session was cancelled.';

function broadcastPendingInput(record, pendingAgentInput) {
  const session = sessions.getById(record.sessionId);
  if (!session) return;
  const payload = { sessionId: record.sessionId, session: { ...session, pendingAgentInput } };
  broadcastToSession(record.sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, payload);
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, { ...payload, projectId: session.projectId });
}

function project(record) {
  const { resolve: _resolve, abortListener: _abortListener, signal: _signal, ...wire } = record;
  return wire;
}

// Removes a record from its session's queue by identity, from anywhere in
// the queue (not just the head), so abort/cancel can settle a non-head
// record without disturbing the rest of the queue's order.
function removeFromQueue(sessionId, id) {
  const queue = prompts.get(sessionId);
  if (!queue) return null;
  const index = queue.findIndex((record) => record.id === id);
  if (index === -1) return null;
  const [record] = queue.splice(index, 1);
  if (queue.length === 0) prompts.delete(sessionId);
  return { record, wasHead: index === 0, queue };
}

function settle(record, outcome, result) {
  const removal = removeFromQueue(record.sessionId, record.id);
  if (!removal) return false;
  record.signal?.removeEventListener('abort', record.abortListener);

  // State removal happens first for exactly-once semantics. The SDK callback
  // must always settle after that transition: audit and websocket failures are
  // observable operational errors, but cannot strand the blocked agent or
  // prevent the next queued interaction from being surfaced.
  persistPromptOutcome(record, outcome, result);
  broadcastPromptResolution(record, outcome);
  if (removal.queue.length === 0) {
    // Queue drained: only now does the "needs attention" badge clear. One
    // prompt resolving must not clear it while a sibling is still queued.
    safelyBroadcast(record, 'clear pending prompt badge', () => broadcastPendingInput(record, false));
  } else if (removal.wasHead) {
    // Promote the new head so a client that already rendered the resolved
    // prompt gets the next one without polling.
    safelyBroadcast(record, 'surface next queued prompt', () => broadcastToSession(record.sessionId, WS_MESSAGE_TYPES.SESSION_PROMPT, {
      sessionId: record.sessionId, prompt: project(removal.queue[0]),
    }));
  }
  record.resolve(result);
  return true;
}

function persistPromptOutcome(record, outcome, result) {
  try {
    const { toolName, content } = describePromptOutcome(record, outcome, result);
    createWorkLog(record.sessionId, 'tool_output', content, toolName);
  } catch (error) {
    reportPromptSideEffectFailure(record, 'persist prompt decision', error);
  }
}

function broadcastPromptResolution(record, outcome) {
  safelyBroadcast(record, 'broadcast prompt resolution', () => broadcastToSession(
    record.sessionId,
    WS_MESSAGE_TYPES.SESSION_PROMPT_RESOLVED,
    { sessionId: record.sessionId, promptId: record.id, outcome },
  ));
}

function safelyBroadcast(record, operation, broadcast) {
  try {
    broadcast();
  } catch (error) {
    reportPromptSideEffectFailure(record, operation, error);
  }
}

function reportPromptSideEffectFailure(record, operation, error) {
  // Never include the prompt payload here: tool input can contain secrets.
  logger.error(`Failed to ${operation} for interactive prompt`, {
    sessionId: record.sessionId,
    promptId: record.id,
    error: error instanceof Error ? error.message : String(error),
  });
}

function describePromptOutcome(record, outcome, result) {
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
  return { toolName, content: permissionHistoryLines(record, outcome, result).join('\n') };
}

function permissionHistoryLines(record, outcome, result) {
  const toolName = record.payload.toolName || 'Unknown tool';
  const decision = {
    allow: 'allow once', always_allow: 'always allow', deny: 'deny',
    superseded: 'superseded', cancelled: 'cancelled',
  }[outcome] || outcome;
  // Durable history persists only allowlisted, safe-by-default content —
  // never the raw input, `title`, or `decisionReason` the live approval card
  // shows. See promptDurableSummary.js for why key-name redaction is not
  // sufficient here: `title` is a full bridge-rendered sentence that can
  // embed the exact command (and any credentials in it), so it is replaced
  // with `displayName` (a short noun-phrase label) for the durable headline.
  const inputSummary = buildSafeToolInputSummary(toolName, record.payload.input);
  const headline = buildSafeHeadline(record.payload.displayName, toolName);
  const blockedPath = buildSafeBlockedPath(record.payload.blockedPath);
  return [
    'Permission decision', `Outcome: ${decision}`, `Tool: ${toolName}`,
    `Headline: ${headline}`,
    blockedPath && `Blocked path: ${blockedPath}`,
    Object.keys(inputSummary).length && `Input summary: ${JSON.stringify(inputSummary)}`,
    outcome === 'always_allow' && `Scope: ${result.updatedPermissions?.[0]?.destination || 'session'}`,
    result.message && `Reason: ${result.message}`,
  ].filter(Boolean);
}

export function parkPrompt({ sessionId, conversationId, kind, toolUseId = null, agentId = null, payload, signal }) {
  // An abort listener added after a signal is already aborted will never fire.
  if (signal?.aborted) return Promise.resolve({ behavior: 'deny', message: CANCELLED_MESSAGE });
  // A duplicate question *within a single call* is a validation error, not a
  // concurrency conflict — reject it outright without touching this
  // session's existing queue.
  const questions = payload.questions || [];
  if (kind === 'question' && questions.length === 0) {
    return Promise.resolve({ behavior: 'deny', message: 'Please re-ask with at least one question.' });
  }
  if (kind === 'question' && new Set(questions.map(({ question }) => question)).size !== questions.length) {
    return Promise.resolve({ behavior: 'deny', message: 'Please re-ask using distinct question text.' });
  }
  return new Promise((resolve) => {
    const record = { id: randomUUID(), sessionId, conversationId, kind, toolUseId, agentId, payload,
      createdAt: Date.now(), resolve, signal, abortListener: null };
    record.abortListener = () => settle(record, 'cancelled', { behavior: 'deny', message: CANCELLED_MESSAGE });
    signal?.addEventListener('abort', record.abortListener, { once: true });
    const queue = prompts.get(sessionId);
    if (queue) {
      // Not the head: queued silently. It is surfaced (SESSION_PROMPT) only
      // once it becomes the head, in `settle`.
      queue.push(record);
      return;
    }
    prompts.set(sessionId, [record]);
    broadcastPendingInput(record, true);
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PROMPT, { sessionId, prompt: project(record) });
  });
}

export function getPrompt(sessionId) {
  const record = prompts.get(sessionId)?.[0];
  return record ? project(record) : null;
}
// Full queue in arrival order, head first. `getPrompt` (head only) is what
// clients hydrate from; this is for introspection (tests, diagnostics).
export function getPromptQueue(sessionId) { return (prompts.get(sessionId) || []).map(project); }
export function hasPendingPrompt(sessionId) { return Boolean(prompts.get(sessionId)?.length); }
export function cancelPrompt(sessionId, reason = CANCELLED_MESSAGE) {
  const queue = prompts.get(sessionId);
  if (!queue || !queue.length) return false;
  // Snapshot before iterating: `settle` mutates (splices) the live queue.
  for (const record of [...queue]) {
    settle(record, 'cancelled', { behavior: 'deny', message: reason });
  }
  return true;
}
function questionResult(record, response) {
  if (response.action === 'answer' && !hasValidQuestionAnswers(record.payload.questions, response.answers, response.customAnswers, response.annotations)) return null;
  return response.action === 'answer'
    ? { behavior: 'allow', updatedInput: {
      ...record.payload.input,
      // Validate selections and free text separately, then serialize only at
      // the SDK boundary. This keeps commas in an Other answer from being
      // mistaken for additional predefined selections.
      answers: serializeQuestionAnswers(record.payload.questions, response.answers, response.customAnswers),
      ...(response.annotations ? { annotations: response.annotations } : {}),
    } }
    : { behavior: 'deny', message: response.reason || 'Proceed on your best judgment and state your assumption.' };
}

function hasValidQuestionAnswers(questions, answers, customAnswers = {}, annotations = {}) {
  const expected = questions || [];
  const expectedKeys = new Set(expected.map(({ question }) => question));
  // hasKnownPromptKeys already verifies annotations is a plain object whose
  // keys are all expected question texts; re-checking that here would be
  // dead code duplicating the same object-ness and key-membership checks.
  if (!hasCompleteAnswerSet(answers, expectedKeys) || !hasKnownPromptKeys(customAnswers, expectedKeys) || !hasKnownPromptKeys(annotations, expectedKeys)) return false;

  return expected.every((question) => {
    const answer = answers[question.question];
    const customAnswer = customAnswers[question.question];
    const options = new Set((question.options || []).map(({ label }) => label));
    return isValidQuestionAnswer(answer, customAnswer, options, question.multiSelect);
  });
}

function hasCompleteAnswerSet(answers, expectedKeys) {
  return hasKnownPromptKeys(answers, expectedKeys)
    && Object.keys(answers).length === expectedKeys.size;
}

function hasKnownPromptKeys(value, expectedKeys) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).every((key) => expectedKeys.has(key));
}

function isValidQuestionAnswer(answer, customAnswer, options, multiSelect) {
  if (!isStructuredSelection(answer) || !isValidCustomAnswer(customAnswer)) return false;
  const selected = answer;
  if (!options.size) return Boolean(selected.length || customAnswer?.trim());
  return hasQuestionAnswer(selected, customAnswer)
    && selectionFitsQuestion(selected, options, multiSelect, customAnswer);
}

function isStructuredSelection(answer) { return Array.isArray(answer) && answer.every((value) => typeof value === 'string' && value); }
function hasQuestionAnswer(selected, customAnswer) { return Boolean(selected.length || customAnswer?.trim()); }
function selectionFitsQuestion(selected, options, multiSelect, customAnswer) {
  return (multiSelect || selected.length <= 1)
    && new Set(selected).size === selected.length
    && selected.every((value) => options.has(value))
    && !(selected.length && customAnswer?.trim());
}

function isValidCustomAnswer(customAnswer) {
  return customAnswer === undefined || (typeof customAnswer === 'string' && Boolean(customAnswer.trim()));
}

function serializeQuestionAnswers(questions, answers, customAnswers = {}) {
  return Object.fromEntries((questions || []).map((question) => {
    const selected = answers[question.question];
    const custom = customAnswers[question.question];
    // “Other” is mutually exclusive with predefined selections, so only one
    // source reaches the SDK's string-only answer field.
    const answer = custom?.trim()
      ? custom
      : selected.join(', ');
    return [question.question, answer];
  }));
}

function permissionResult(record, response) {
  if (response.action === 'allow') return { behavior: 'allow' };
  if (response.action === 'always_allow' && Array.isArray(record.payload.suggestions) && record.payload.suggestions.length) {
    return {
      behavior: 'allow',
      updatedPermissions: record.payload.suggestions.map((suggestion) => ({
        ...suggestion,
        destination: response.destination || 'session',
      })),
    };
  }
  if (response.action === 'always_allow') {
    return { behavior: 'deny', message: 'Always allow is unavailable for this permission request.' };
  }
  return { behavior: 'deny', message: response.reason || 'Permission denied by user.' };
}

// Only the queue head is ever surfaced to a client (`getPrompt` returns it,
// and it is the one carried in the SESSION_PROMPT broadcast), so a response
// resolves the head deterministically. A `promptId` for a queued-but-not-head
// prompt — stale by definition, since the client cannot have rendered it yet —
// is rejected as not-current rather than resolved out of order.
export function respondToPrompt(sessionId, promptId, response) {
  const record = prompts.get(sessionId)?.[0];
  if (!record || record.id !== promptId) return false;
  if (!PROMPT_ACTIONS_BY_KIND[record.kind]?.has(response.action)) return null;
  const result = record.kind === 'question' ? questionResult(record, response) : permissionResult(record, response);
  if (!result) return null;
  return settle(record, response.action, result);
}
