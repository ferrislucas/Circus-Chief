/**
 * Gemini CLI event mapper.
 *
 * Translates Gemini CLI `--output-format stream-json` JSONL events into the
 * normalized SDK-shaped events that Circus Chief already understands:
 *
 *   - system(init)
 *   - stream_event(content_block_delta)
 *   - assistant
 *   - tool_result
 *   - result(success, usage)
 *
 * @param {Object} [options]
 * @param {string} [options.model] - Model name to surface in the system(init) event.
 * @returns {{
 *   map: (geminiEvent: Object) => Array<Object>,
 *   reset: () => void,
 *   finalize: () => Array<Object>
 * }}
 */
export function createGeminiEventMapper({ model } = {}) {
  const state = new GeminiMapperState();
  const warnedUnknownTypes = new Set();

  function map(geminiEvent) {
    if (!geminiEvent || typeof geminiEvent !== 'object') return [];

    const type = geminiEvent.type;

    if (type === 'init') {
      return handleInit(geminiEvent, model);
    }
    if (type === 'message') {
      return handleMessage(geminiEvent);
    }
    if (type === 'tool_use') {
      return handleToolUse(geminiEvent, state);
    }
    if (type === 'tool_result') {
      return handleToolResult(geminiEvent, state);
    }
    if (type === 'result') {
      return state.onResult(geminiEvent);
    }

    // Unknown event type — warn once
    if (type && !warnedUnknownTypes.has(type)) {
      warnedUnknownTypes.add(type);
      console.warn(`[geminiEventMapper] Unknown Gemini event type: "${type}"`);
    }
    return [];
  }

  return {
    map,
    reset: () => state.reset(),
    finalize: () => state.finalize(),
  };
}

// --- State class -----------------------------------------------------------

class GeminiMapperState {
  constructor() {
    this.reset();
  }

  reset() {
    this.lastUsage = null;
    this.terminated = false;
    this.pendingToolUse = new Map();
  }

  finalize() {
    if (this.terminated) return [];
    this.terminated = true;
    return [this.buildResultEvent()];
  }

  onResult(evt) {
    if (evt.stats) {
      this.lastUsage = {
        input_tokens: evt.stats.input_tokens || 0,
        output_tokens: evt.stats.output_tokens || 0,
      };
    }
    this.terminated = true;
    return [this.buildResultEvent()];
  }

  buildResultEvent() {
    const usage = this.lastUsage || { input_tokens: 0, output_tokens: 0 };
    return {
      type: 'result',
      subtype: 'success',
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
      },
    };
  }
}

// --- Event handlers --------------------------------------------------------

function handleInit(evt, constructorModel) {
  return [{
    type: 'system',
    subtype: 'init',
    session_id: evt.session_id || `gemini-${Date.now()}`,
    model: evt.model || constructorModel || undefined,
  }];
}

function handleMessage(evt) {
  // Ignore user message echoes
  if (evt.role === 'user') return [];

  if (evt.role === 'assistant') {
    const text = evt.content || '';

    // Delta (streaming partial)
    if (evt.delta) {
      return [{
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text },
        },
      }];
    }

    // Full message (non-delta)
    return [{
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    }];
  }

  return [];
}

function handleToolUse(evt, state) {
  const toolName = evt.tool_name || 'unknown';
  const toolId = evt.tool_id || `tool-${Date.now()}`;
  const parameters = evt.parameters || {};

  // Track for matching tool_result back
  state.pendingToolUse.set(toolId, toolName);

  return [{
    type: 'tool_result',
    tool_name: toolName,
    content: JSON.stringify(parameters),
  }];
}

function handleToolResult(evt, state) {
  const toolId = evt.tool_id || '';
  const toolName = state.pendingToolUse.get(toolId) || 'unknown';
  const output = evt.output || '';

  return [{
    type: 'tool_result',
    tool_name: toolName,
    content: output,
  }];
}
