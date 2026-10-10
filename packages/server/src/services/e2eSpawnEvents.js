/**
 * Agent-type-specific JSONL event writers for the E2E scripted spawn-capture
 * seam (see e2eSpawnCapture.js). Each writer emits the same wire protocol the
 * real Claude Code / Codex / Gemini CLIs use on stdout.
 */

export function writeJsonLine(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

/**
 * Full success sequence for `agentType`, ending with a terminal
 * result/turn.completed event.
 */
export function writeCapturedAgentEvents(agentType, stdout) {
  if (agentType === 'codex') {
    writeJsonLine(stdout, { type: 'thread.started', thread_id: `e2e-codex-${Date.now()}` });
    writeJsonLine(stdout, { type: 'turn.started' });
    writeJsonLine(stdout, {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'E2E spawn capture response.' },
    });
    writeJsonLine(stdout, {
      type: 'turn.completed',
      usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
    });
    return;
  }

  if (agentType === 'gemini') {
    // Gemini CLI stream-json format: init → message → result
    writeJsonLine(stdout, {
      type: 'init',
      session_id: `e2e-gemini-${Date.now()}`,
    });
    writeJsonLine(stdout, {
      type: 'message',
      role: 'assistant',
      content: 'E2E spawn capture response.',
    });
    writeJsonLine(stdout, {
      type: 'result',
      stats: { input_tokens: 0, output_tokens: 0 },
    });
    return;
  }

  writeJsonLine(stdout, {
    type: 'system',
    subtype: 'init',
    session_id: `e2e-claude-${Date.now()}`,
  });
  writeJsonLine(stdout, {
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'E2E spawn capture response.' }] },
  });
  writeJsonLine(stdout, {
    type: 'result',
    subtype: 'success',
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}

/**
 * Write a single assistant-output event (no terminal "result"/"turn.completed"
 * event) for the 'output_then_error' outcome — simulates a turn that started
 * producing output before the service failed, so
 * `sessionHasNoAssistantMessages` sees a persisted assistant message and the
 * failover loop correctly treats the subsequent error as non-eligible
 * (mid-conversation), not a start-time failure.
 */
export function writePartialAgentOutput(agentType, stdout) {
  if (agentType === 'codex') {
    writeJsonLine(stdout, { type: 'thread.started', thread_id: `e2e-codex-${Date.now()}` });
    writeJsonLine(stdout, { type: 'turn.started' });
    writeJsonLine(stdout, {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'E2E spawn capture partial response before failure.' },
    });
    return;
  }

  if (agentType === 'gemini') {
    writeJsonLine(stdout, { type: 'init', session_id: `e2e-gemini-${Date.now()}` });
    writeJsonLine(stdout, {
      type: 'message',
      role: 'assistant',
      content: 'E2E spawn capture partial response before failure.',
    });
    return;
  }

  writeJsonLine(stdout, { type: 'system', subtype: 'init', session_id: `e2e-claude-${Date.now()}` });
  writeJsonLine(stdout, {
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'E2E spawn capture partial response before failure.' }] },
  });
}
