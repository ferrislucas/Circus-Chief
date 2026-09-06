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

// App Server interactive input is experimental and therefore must be explicitly
// acknowledged. Keep this protocol-version contract at the codec boundary.
export function validateInitializeResult(result) {
  if (result?.capabilities?.experimentalApi !== true) {
    throw new Error('Codex App Server is incompatible: experimentalApi capability is required');
  }
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
    responseContext: createResponseContext(request.id, questions),
  };
}

function createResponseContext(externalRequestId, questions) {
  return Object.freeze({
    externalRequestId,
    nativeOptionsByQuestion: Object.freeze(Object.fromEntries(questions.map((question) => [
      question.id,
      Object.freeze(Object.fromEntries((question.options || []).map((option, index) => [`option-${index}`, option.label]))),
    ]))),
  });
}

function normalizeQuestion(question, ids) {
  validateQuestion(question, ids);
  ids.add(question.id);
  const options = question.options == null ? [] : question.options;
  validateOptions(options);
  return {
    id: question.id, prompt: question.question, question: question.question, header: question.header || '',
    mode: options.length ? (question.isMultiSelect ? 'multiple' : 'single') : 'text', required: true, allowOther: question.isOther === true,
    options: options.map((option, index) => {
      const id = `option-${index}`;
      return { id, label: option.label, description: option.description };
    }),
  };
}
function validateQuestion(question, ids) {
  if (!question || typeof question.id !== 'string' || !question.id || question.id.length > 128 || ids.has(question.id)) throw new Error('Codex question ids must be unique bounded strings');
  if (typeof question.question !== 'string' || !question.question.trim() || question.question.length > MAX_TEXT) throw new Error('Codex question text is invalid');
  if (question.header != null && (typeof question.header !== 'string' || question.header.length > 256)) throw new Error('Codex question header is invalid');
  if (question.isOther != null && typeof question.isOther !== 'boolean') throw new Error('Codex question other-answer mode is invalid');
  if (question.isMultiSelect != null && typeof question.isMultiSelect !== 'boolean') throw new Error('Codex question multi-select mode is invalid');
}
function validateOptions(options) {
  if (!Array.isArray(options) || options.length > MAX_OPTIONS) throw new Error('Codex question options exceed the supported limit');
  if (options.some((option) => !option || typeof option.label !== 'string' || !option.label.trim() || option.label.length > 512 || typeof option.description !== 'string' || option.description.length > MAX_TEXT)) throw new Error('Codex option is invalid');
}
export function encodeUserInputResponse(responseContext, outcome) {
  if (outcome?.action !== 'answer') throw new Error('Codex App Server has no safe cancellation response for requestUserInput');
  if (!responseContext || typeof responseContext !== 'object') throw new Error('Codex user-input response context is invalid');
  return { id: responseContext.externalRequestId, result: { answers: Object.fromEntries(outcome.answers.map((answer) => [answer.questionId, {
    answers: answer.text ? [answer.text] : nativeAnswers(responseContext, answer),
  }])) } };
}

function nativeAnswers({ nativeOptionsByQuestion }, { questionId, selectedOptionIds }) {
  const nativeOptions = nativeOptionsByQuestion?.[questionId];
  if (!nativeOptions || !Array.isArray(selectedOptionIds) || new Set(selectedOptionIds).size !== selectedOptionIds.length) {
    throw new Error('Codex user-input response contains an unknown or malformed option id');
  }
  const answers = selectedOptionIds.map((id) => nativeOptions[id]);
  if (answers.some((answer) => typeof answer !== 'string')) throw new Error('Codex user-input response contains an unknown or malformed option id');
  return answers;
}

export function encodeError(id, code, message) { return { id, error: { code, message } }; }
