const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 16;
const MAX_TEXT = 8_000;

export function parseJsonRpcLine(line) {
  let message;
  try { message = JSON.parse(line); } catch { throw new Error('Codex App Server emitted invalid JSON-RPC'); }
  if (!message || typeof message !== 'object') throw new Error('Codex App Server emitted a non-object JSON-RPC message');
  if ('id' in message && 'method' in message) return { type: 'request', message };
  if ('id' in message && ('result' in message || 'error' in message)) return { type: 'response', message };
  if (typeof message.method === 'string') return { type: 'notification', message };
  throw new Error('Codex App Server emitted an unclassifiable JSON-RPC message');
}

export function initializeParams() {
  return { clientInfo: { name: 'Circus Chief', version: '1.0.0' }, capabilities: { experimentalApi: true } };
}

export function normalizeUserInputRequest(request) {
  if (request?.method !== 'item/tool/requestUserInput' || !request.params || request.id == null) throw new Error('Unsupported Codex server request');
  const { threadId, turnId, itemId, questions } = request.params;
  if (![threadId, turnId, itemId].every((value) => typeof value === 'string' && value)) throw new Error('Malformed Codex user-input request context');
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > MAX_QUESTIONS) throw new Error('Codex user-input requests must contain 1–3 questions');
  const ids = new Set();
  return {
    externalRequestId: request.id,
    metadata: { threadId, turnId, itemId },
    payload: { questions: questions.map((question) => normalizeQuestion(question, ids)) },
  };
}

function normalizeQuestion(question, ids) {
  if (!question || typeof question.id !== 'string' || !question.id || question.id.length > 128 || ids.has(question.id)) throw new Error('Codex question ids must be unique bounded strings');
  ids.add(question.id);
  if (typeof question.question !== 'string' || !question.question.trim() || question.question.length > MAX_TEXT) throw new Error('Codex question text is invalid');
  const options = question.options == null ? [] : question.options;
  if (!Array.isArray(options) || options.length > MAX_OPTIONS) throw new Error('Codex question options exceed the supported limit');
  const optionIds = new Set();
  return {
    id: question.id, prompt: question.question, question: question.question, header: bounded(question.header, 256),
    mode: options.length ? 'single' : 'text', required: true, allowOther: Boolean(question.isOther),
    options: options.map((option, index) => {
      if (!option || typeof option.label !== 'string' || !option.label.trim() || option.label.length > 512 || typeof option.description !== 'string' || option.description.length > MAX_TEXT) throw new Error('Codex option is invalid');
      const id = `option-${index}`;
      if (optionIds.has(id)) throw new Error('Codex option ids must be unique');
      optionIds.add(id);
      return { id, label: option.label, description: option.description };
    }),
  };
}
function bounded(value, length) { return typeof value === 'string' ? value.slice(0, length) : ''; }

export function encodeUserInputResponse(externalRequestId, outcome) {
  if (outcome?.action !== 'answer') throw new Error('Codex App Server has no safe cancellation response for requestUserInput');
  return { id: externalRequestId, result: { answers: Object.fromEntries(outcome.answers.map((answer) => [answer.questionId, {
    answers: answer.text ? [answer.text] : answer.selectedOptionIds,
  }])) } };
}

export function encodeError(id, code, message) { return { id, error: { code, message } }; }
