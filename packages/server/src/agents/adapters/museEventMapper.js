/**
 * Muse event mapper.
 *
 * Translates Muse Session Protocol (MSP) view items — as yielded by the
 * `@muse-code/sdk` facade's `turn.items()` iterator — into the normalized
 * SDK-shaped events that Circus Chief's stream event handler already
 * understands for Claude Code:
 *
 *   - {@code system(init)}
 *   - {@code stream_event(content_block_delta)}
 *   - {@code assistant}
 *   - {@code tool_result}
 *   - {@code result(success, usage)}
 *
 * MSP item shapes below are grounded in `@muse-code/sdk@1.4.2`
 * (`dist/src/msp.d.ts`, itself generated from the `muse schema`
 * JSON-Schema bundle) and in the wire-open evolution rule from the
 * schema: `ItemKind` is OPEN — new kinds are additive, and clients MUST
 * render unknown kinds generically (kind name + status + `fallbackText`).
 * The mapper follows that rule: known kinds map precisely, unknown kinds
 * with `fallbackText` degrade to a generic `tool_result`, and unknown
 * kinds without any renderable text emit a generic transcript notice
 * (warn-once on the console) so the dropped item stays visible.
 *
 * MSP kinds handled in v1:
 *   - {@code userMessage}  — prompt echo (or steered injection); ignored.
 *   - {@code agentMessage} — {@code text} is the accumulated reply → emitted
 *     as text_delta + assistant (mirrors the Codex mapper).
 *   - {@code reasoning}    — committed reasoning {@code text} → tool_result
 *     (never streamed in MSP v1, so no thinking-delta path).
 *   - {@code toolCall}     — {@code tool}/{@code args}/{@code visibleOutput}
 *     → tool_result.
 *   - {@code userShell}    — {@code commandText}/{@code exitCode} → tool_result.
 *   - {@code subagent} / {@code workflow} / {@code reminderChild} /
 *     {@code compaction} → tool_result summary.
 *
 * Turn terminals ({@code TurnCompletedParams.terminal}: completed/failed/
 * cancelled, open for evolution) map to `result` events: `completed`
 * without an error → success with usage; anything else → error subtype so
 * the completion path surfaces it instead of silently succeeding.
 *
 * Pure in-process — no I/O, no timers, no child processes.
 *
 * @param {Object} [options]
 * @param {string} [options.model] - Optional model name to surface in the
 *   {@code system(init)} event.
 * @returns {{
 *   mapItem: (item: Object) => Array<Object>,
 *   mapOutcome: (outcome: Object) => Array<Object>,
 *   mapCancellation: () => Array<Object>,
 *   mapWorkflowTerminal: (item: Object) => Array<Object>,
 *   reset: () => void,
 *   finalize: () => Array<Object>,
 *   buildSystemInit: (sessionId: string) => Object,
 *   buildNotice: (text: string) => Object
 * }}
 */
export function createMuseEventMapper({ model } = {}) {
  const state = new MuseMapperState();
  const warnedUnknownKinds = new Set();

  /**
   * Map one folded MSP item to normalized SDK events.
   * @param {Object} item - Folded MSP `Item` (at its current revision).
   * @returns {Array<Object>} Normalized SDK events.
   */
  function mapItem(item) {
    if (!item || typeof item !== 'object') return [];
    // Retracted user messages carry no durable content.
    if (item.retracted) return [];
    return mapByKind(item);
  }

  function mapByKind(item) {
    switch (item.kind) {
      case 'userMessage':
        return [];
      case 'agentMessage':
        return mapAgentMessage(item);
      case 'reasoning':
        return [mapReasoning(item)];
      case 'toolCall':
        return [mapToolCall(item)];
      case 'userShell':
        return [mapUserShell(item)];
      case 'subagent':
      case 'workflow':
      case 'reminderChild':
      case 'compaction':
        return [mapSummaryKind(item)];
      default:
        return mapUnknownKind(item, warnedUnknownKinds);
    }
  }

  /**
   * Map a settled turn outcome to terminal `result` events.
   * @param {Object} outcome - SDK `TurnOutcome`
   *   ({ kind: 'completed'|'unqueued'|'terminalUnknown', params? }).
   * @returns {Array<Object>} Zero or one `result` events.
   */
  function mapOutcome(outcome) {
    if (!outcome || typeof outcome !== 'object') return [];
    state.markTerminated();
    if (outcome.kind === 'completed') {
      if (outcome.params) return [mapCompletedTurn(outcome.params)];
      return [buildSuccessResult(null)];
    }
    const label = outcome.kind === 'unqueued'
      ? 'Muse turn was unqueued before reaching a terminal'
      : 'Muse host died before the turn reached a terminal';
    return [buildErrorResult(label)];
  }

  /**
   * Terminal event for an aborted turn. Marks the mapper terminated so the
   * stream never ends after `system(init)` with no outcome and `finalize()`
   * cannot emit a second terminal afterwards.
   */
  function mapCancellation() {
    state.markTerminated();
    return [{ type: 'result', subtype: 'cancelled' }];
  }

  function mapWorkflowTerminal(item) {
    state.markTerminated();
    const status = String(item?.status || '').toLowerCase();
    if (status === 'cancelled' || status === 'canceled') return [{ type: 'result', subtype: 'cancelled' }];
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const text = typeof item?.message === 'string' ? item.message.trim() : '';
      if (!text) return [buildErrorResult('Muse workflow completed without a final message.')];
      return [
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } },
        { type: 'assistant', message: { content: [{ type: 'text', text }] } },
        buildSuccessResult(item.usage),
      ];
    }
    return [buildErrorResult(item?.failureReason || item?.reason || `Muse workflow ${item?.status || 'failed'}`)];
  }

  return {
    mapItem,
    mapOutcome,
    mapCancellation,
    mapWorkflowTerminal,
    reset: () => state.reset(),
    finalize: () => state.finalize(),
    // Exposed for the adapter: the MSP session id becomes the resume
    // handle stored on the conversation (same column Claude uses).
    buildSystemInit: (sessionId) => buildSystemInit(sessionId, model),
    buildNotice,
  };
}

// --- Mapper state ----------------------------------------------------------

class MuseMapperState {
  constructor() {
    this.reset();
  }

  reset() {
    this.terminated = false;
  }

  markTerminated() {
    this.terminated = true;
  }

  /**
   * Called by the adapter when the turn iterator ends without an explicit
   * terminal outcome. Returns a terminal result event if one hasn't been
   * emitted yet; otherwise an empty array.
   */
  finalize() {
    if (this.terminated) return [];
    this.terminated = true;
    return [buildErrorResult('Muse execution ended without a terminal result.')];
  }
}

// --- Terminal results ------------------------------------------------------

function toClaudeUsage(usage) {
  return {
    input_tokens: usage?.inputTokens || 0,
    output_tokens: usage?.outputTokens || 0,
  };
}

function buildSuccessResult(usage) {
  return {
    type: 'result',
    subtype: 'success',
    usage: toClaudeUsage(usage),
  };
}

function buildErrorResult(message) {
  return {
    type: 'result',
    subtype: 'error',
    is_error: true,
    error: message || 'Muse turn failed',
  };
}

function mapCompletedTurn(params) {
  const terminal = params.terminal || 'completed';
  if (terminal === 'completed' && !params.error) {
    return buildSuccessResult(params.usage);
  }
  const message = params.error?.message
    || (params.reason ? `Muse turn ${terminal}: ${params.reason}` : `Muse turn ${terminal}`);
  return buildErrorResult(message);
}

function buildSystemInit(sessionId, model) {
  const init = {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
  };
  if (model) init.model = model;
  return init;
}

/**
 * User-visible notice event (finding #10): an `assistant` text event so the
 * stream handler saves and broadcasts it as a transcript message — not a
 * console-only warning.
 * @param {string} text - Already-scrubbed notice text.
 */
function buildNotice(text) {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  };
}

// --- Item handlers ---------------------------------------------------------

function mapAgentMessage(item) {
  const text = typeof item.text === 'string' ? item.text : '';
  if (!text) return [];
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

function mapReasoning(item) {
  return {
    type: 'tool_result',
    tool_name: 'reasoning',
    content: item.text || item.fallbackText || '',
  };
}

function formatToolResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function mapToolCall(item) {
  const parts = [];
  if (item.visibleOutput) {
    parts.push(item.visibleOutput);
  } else {
    const outcome = formatToolResult(item.result);
    if (outcome) parts.push(outcome);
  }
  if (item.failureReason) parts.push(`failure: ${item.failureReason}`);
  else if (item.failureKind) parts.push(`failureKind: ${item.failureKind}`);
  // Finding #12b: structured args render as parseable JSON, never the
  // String()-collapsed `[object Object]`.
  if (parts.length === 0 && item.args) parts.push(formatToolResult(item.args));
  return {
    type: 'tool_result',
    tool_name: item.tool || 'tool_call',
    content: parts.join('\n'),
  };
}

function mapUserShell(item) {
  const parts = [`$ ${item.commandText || ''}`];
  if (item.exitCode !== undefined && item.exitCode !== 0) {
    parts.push(`exit code: ${item.exitCode}`);
  }
  if (item.exitSignal !== undefined) {
    parts.push(`signal: ${item.exitSignal}`);
  }
  if (item.visibleOutput) parts.push(item.visibleOutput);
  if (item.failureReason) parts.push(`failure: ${item.failureReason}`);
  return {
    type: 'tool_result',
    tool_name: 'user_shell',
    content: parts.join('\n'),
  };
}

function mapSummaryKind(item) {
  const parts = [];
  if (item.objective) parts.push(item.objective);
  if (item.text) parts.push(item.text);
  if (item.message) parts.push(item.message);
  if (item.fallbackText) parts.push(item.fallbackText);
  if (item.failureReason) parts.push(`failure: ${item.failureReason}`);
  if (item.childSessionId) parts.push(`child session: ${item.childSessionId}`);
  return {
    type: 'tool_result',
    tool_name: item.kind,
    content: parts.join('\n'),
  };
}

function mapUnknownKind(item, warnedKinds) {
  // Wire-open evolution: render generically when the server gave us text.
  // Finding #11: when there is nothing renderable, still leave a generic
  // notice in the transcript (console-only would hide the dropped item).
  if (item.kind && !warnedKinds.has(item.kind)) {
    warnedKinds.add(item.kind);
    console.warn(`[museEventMapper] Received unsupported item.kind "${item.kind}"`);
  }
  const generic = item.fallbackText || item.text || '';
  if (!generic) {
    return [{
      type: 'tool_result',
      tool_name: item.kind || 'unknown',
      content: `Muse sent an unsupported item (kind "${item.kind || 'unknown'}") with no display text; nothing was rendered for it.`,
    }];
  }
  return [{
    type: 'tool_result',
    tool_name: item.kind || 'unknown',
    content: generic,
  }];
}
