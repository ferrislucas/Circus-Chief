import { parkPrompt } from '../../services/promptStore.js';

/**
 * Present a Grok `askUserQuestion` request on the existing agent prompt card
 * and translate the parked answer back into Grok's ACP response.
 * Permission requests never come through here.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string|null} params.conversationId
 * @param {Object} params.request - ACP ext-method params
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object>}
 */
export async function answerGrokQuestion({ sessionId, conversationId, request, signal }) {
  const questions = Array.isArray(request?.questions) ? request.questions : [];
  if (!sessionId || questions.length === 0) return { outcome: 'cancelled' };
  const parked = await parkPrompt({
    sessionId,
    conversationId: conversationId || null,
    kind: 'question',
    toolUseId: request.toolCallId || null,
    payload: { questions, input: { questions } },
    signal,
  });
  return toGrokQuestionResult(parked, questions);
}

/**
 * @param {{ behavior?: string, updatedInput?: Object }|null} parked
 * @param {Array} questions
 */
export function toGrokQuestionResult(parked, questions) {
  if (!parked || parked.behavior !== 'allow') return { outcome: 'cancelled' };
  const raw = parked.updatedInput?.answers || {};
  const incoming = parked.updatedInput?.annotations || {};
  const answers = {};
  const annotations = {};
  for (const question of questions) {
    const mapped = mapQuestionAnswer(question, raw, incoming);
    if (!mapped) continue;
    answers[mapped.key] = mapped.answer;
    if (mapped.annotation) annotations[mapped.key] = mapped.annotation;
  }
  if (Object.keys(answers).length === 0) return { outcome: 'cancelled' };
  const response = { outcome: 'accepted', answers };
  if (Object.keys(annotations).length) response.annotations = annotations;
  return response;
}

function mapQuestionAnswer(question, raw, incoming) {
  const key = question?.question;
  const value = raw[key];
  if (!key || typeof value !== 'string' || !value.trim()) return null;
  const labels = (question.options || []).map((option) => option.label).filter(Boolean);
  const selected = matchSelections(value, labels, Boolean(question.multiSelect || question.multi_select));
  return {
    key,
    answer: selected.length ? selected : ['Other'],
    annotation: mergeAnnotation(selected, value, incoming[key]),
  };
}

function mergeAnnotation(selected, value, incoming) {
  const base = selected.length ? null : { notes: value };
  if (!incoming || typeof incoming !== 'object') return base;
  return { ...(base || {}), ...incoming };
}

function matchSelections(value, labels, multiSelect) {
  if (labels.includes(value)) return [value];
  if (!multiSelect) return [];
  const parts = value.split(', ');
  if (parts.length > 1 && parts.every((part) => labels.includes(part))) return parts;
  return [];
}
