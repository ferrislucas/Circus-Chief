import { usageFromGrokPrompt } from './grokUsage.js';

const GROK_EFFORT = Object.freeze({
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'xhigh',
});

/**
 * Pure mappings from captured ACP session/update notifications and the
 * session/prompt result into Circus Chief's SDK-shaped envelope.
 * Unknown updates are ignored. Text is streamed as deltas and persisted
 * once, as a single assistant message, when the turn finishes.
 */
export function createGrokAcpEventMapper() {
  const state = {
    text: '',
    terminated: false,
    tools: new Map(),
  };

  function mapUpdate(params) {
    const update = params?.update || params;
    const kind = update?.sessionUpdate || update?.type;
    if (kind === 'agent_message_chunk' || kind === 'agent_message') {
      return textDelta(chunkText(update));
    }
    if (kind === 'tool_call') return toolCall(update);
    if (kind === 'tool_call_update') return toolUpdate(update);
    return [];
  }

  function finish(result, sessionKey) {
    if (state.terminated) return [];
    state.terminated = true;
    const events = [];
    const text = state.text;
    state.text = '';
    if (text) {
      events.push({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    }
    events.push({
      type: 'result',
      subtype: result?.stopReason === 'error' ? 'error' : 'success',
      usage: usageFromGrokPrompt(result, sessionKey),
    });
    return events;
  }

  function textDelta(text) {
    if (!text) return [];
    state.text += text;
    return [{
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
    }];
  }

  function toolCall(update) {
    const id = update.toolCallId || `tool-${state.tools.size + 1}`;
    const name = update.title || update.kind || 'tool';
    state.tools.set(id, name);
    return [{
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id, name, input: update.rawInput || {} }],
      },
    }];
  }

  function toolUpdate(update) {
    const id = update.toolCallId || '';
    const name = state.tools.get(id) || update.title || 'tool';
    if (update.status && update.status !== 'completed' && update.status !== 'failed') return [];
    const content = update.rawOutput ?? update.content ?? update.status ?? '';
    return [{
      type: 'tool_result',
      tool_use_id: id,
      tool_name: name,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    }];
  }

  return { mapUpdate, finish };
}

export function grokEffortValue(level) {
  if (!level || level === 'auto') return null;
  return GROK_EFFORT[level] || null;
}

export function modelsFromInitialize(init) {
  const state = init?._meta?.modelState || init?.modelState || {};
  const raw = state.availableModels || init?.models || [];
  return normalizeModelIds(raw);
}

export function currentModelFromInitialize(init) {
  return init?._meta?.modelState?.currentModelId || init?.modelState?.currentModelId || null;
}

export function configOptionIds(session) {
  const options = session?.configOptions || [];
  return new Set(options.map((option) => option?.id || option?.configId).filter(Boolean));
}

function chunkText(update) {
  const content = update?.content;
  if (typeof content === 'string') return content;
  if (typeof content?.text === 'string') return content.text;
  if (typeof update?.text === 'string') return update.text;
  return '';
}

export function normalizeModelIds(raw) {
  const values = Array.isArray(raw) ? raw : [];
  const ids = [];
  for (const entry of values) {
    const id = typeof entry === 'string' ? entry : (entry?.id || entry?.modelId || entry?.name);
    if (typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/.test(id)) ids.push(id);
  }
  return [...new Set(ids)];
}
