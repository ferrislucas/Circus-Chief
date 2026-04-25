/**
 * Codex event mapper.
 *
 * Translates the real Codex CLI JSON-line event schema (as emitted by
 * `codex exec --json`) into the normalized SDK-shaped events that Circus
 * Chief's stream event handler already understands for Claude Code:
 *
 *   - {@code system(init)}
 *   - {@code stream_event(content_block_delta)}
 *   - {@code assistant}
 *   - {@code result(success, usage)}
 *
 * Real Codex event types (v0.124.0, confirmed via
 * `codex app-server generate-json-schema`):
 *
 *   - {@code thread.started}   — { thread_id }
 *   - {@code turn.started}     — no payload
 *   - {@code item.started}     — { item: ThreadItem }
 *   - {@code item.completed}   — { item: ThreadItem }
 *   - {@code turn.completed}   — { usage: { input_tokens, cached_input_tokens, output_tokens } }
 *   - {@code turn.failed}      — { error: { message } }
 *   - {@code error}            — { message } (transient, treated as fatal)
 *
 * ThreadItem.type variants handled in v1:
 *   - {@code agent_message} — { id, text, ... }  → emitted as text_delta + assistant
 *
 * All other variants (reasoning, command_execution, file_change, mcp_tool_call,
 * dynamic_tool_call, collab_agent_tool_call, web_search, image_view, image_generation,
 * plan, context_compaction, hook_prompt, entered_review_mode, exited_review_mode,
 * user_message) are currently ignored. Tool-use plumbing is deferred to a
 * later phase.
 *
 * The mapper is stateful across calls so it can accumulate agent message
 * text across multiple `item.completed` events within a turn and stash
 * usage counters until the terminal `turn.completed`.
 *
 * Pure in-process — no I/O, no timers, no child processes.
 *
 * @param {Object} [options]
 * @param {string} [options.model] - Optional model name to surface in the
 *   {@code system(init)} event. Codex's {@code thread.started} event does
 *   not carry the model, so the adapter must pass it in.
 * @returns {{
 *   map: (codexEvent: Object) => Array<Object>,
 *   reset: () => void,
 *   finalize: () => Array<Object>
 * }}
 */
export function createCodexEventMapper({ model } = {}) {
  const mapperState = new MapperState();
  const warnedUnknownItemTypes = new Set();

  const handlers = {
    'thread.started': (evt) => handleThreadStarted(evt, model),
    'turn.started': () => [],
    'item.started': () => [],
    'item.completed': (evt) => handleItemCompleted(evt, mapperState, warnedUnknownItemTypes),
    'turn.completed': (evt) => mapperState.onTurnCompleted(evt),
    'turn.failed': (evt) => handleTurnFailed(evt),
    'error': (evt) => handleError(evt),
  };

  function map(codexEvent) {
    if (!codexEvent || typeof codexEvent !== 'object') return [];
    const handler = handlers[codexEvent.type];
    if (!handler) {
      console.warn(`[codexEventMapper] Unknown Codex event type: "${codexEvent.type}"`);
      return [];
    }
    return handler(codexEvent);
  }

  return {
    map,
    reset: () => mapperState.reset(),
    finalize: () => mapperState.finalize(),
  };
}

// --- Mapper state class ----------------------------------------------------

class MapperState {
  constructor() {
    this.reset();
  }

  reset() {
    this.lastUsage = null;
    this.terminated = false;
  }

  /**
   * Called by the adapter when the underlying stream ends without an explicit
   * {@code turn.completed}. Returns a terminal result event if one hasn't been
   * emitted yet; otherwise an empty array.
   */
  finalize() {
    if (this.terminated) return [];
    this.terminated = true;
    return [this.buildResultEvent()];
  }

  onTurnCompleted(evt) {
    if (evt && evt.usage) {
      this.lastUsage = {
        input_tokens: evt.usage.input_tokens,
        output_tokens: evt.usage.output_tokens,
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

// --- Pure event handlers ---------------------------------------------------

function handleThreadStarted(evt, model) {
  const init = {
    type: 'system',
    subtype: 'init',
    session_id: evt.thread_id,
  };
  if (model) init.model = model;
  return [init];
}

function handleItemCompleted(evt, _state, warnedTypes) {
  const item = evt.item;
  if (!item || typeof item !== 'object') return [];

  if (item.type === 'agent_message') {
    const text = typeof item.text === 'string' ? item.text : '';
    return [
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text },
        },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text }] },
      },
    ];
  }

  // Variants deferred to a later phase: reasoning, command_execution,
  // file_change, mcp_tool_call, dynamic_tool_call, collab_agent_tool_call,
  // web_search, image_view, image_generation, plan, context_compaction,
  // hook_prompt, entered_review_mode, exited_review_mode, user_message.
  if (item.type && !warnedTypes.has(item.type)) {
    warnedTypes.add(item.type);
    console.warn(`[codexEventMapper] Ignoring unsupported item.type "${item.type}" (deferred to a later phase)`);
  }
  return [];
}

function handleTurnFailed(evt) {
  const message = evt?.error?.message || 'Codex turn failed';
  throw new Error(message);
}

function handleError(evt) {
  const message = evt?.message || 'Codex error';
  throw new Error(message);
}
