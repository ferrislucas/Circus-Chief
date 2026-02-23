/**
 * Mock query generator for E2E testing
 * Simulates the Claude SDK's behavior for multi-turn conversations
 * @param {Object} params
 * @param {string} params.prompt - The prompt string
 */
export async function* mockQuery({ prompt }) {
  // Yield system init event
  yield {
    type: 'system',
    subtype: 'init',
    session_id: 'mock-session-' + Date.now(),
    model: 'claude-sonnet-4-6',
  };

  // Small delay to simulate processing
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Yield message_start event with initial usage (enables real-time token updates)
  yield {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        usage: {
          input_tokens: prompt.split(' ').length, // Simple estimate: one token per word
          output_tokens: 0,
        },
      },
    },
  };

  // Simulate thinking (creates a work log)
  yield {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'Analyzing the request...' },
    },
  };
  yield {
    type: 'stream_event',
    event: { type: 'content_block_stop' },
  };

  // Simulate tool use (creates work logs for input)
  const toolUseId = 'mock-tool-' + Date.now();
  yield {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'Bash',
          input: { command: 'echo "mock command"' },
        },
      ],
    },
  };

  // Simulate tool result (creates work log for output)
  yield {
    type: 'tool_result',
    tool_name: 'Bash',
    content: 'mock command output',
  };

  await new Promise((resolve) => setTimeout(resolve, 50));

  // Generate a mock response based on the user's message
  const responseText = `Mock response to: "${prompt}"`;

  // Yield message_delta events to simulate streaming output tokens (enables real-time token updates)
  // Send multiple deltas to simulate streaming
  const words = responseText.split(' ');
  let outputTokens = 0;
  for (const word of words) {
    outputTokens += 2; // Simulate 2 tokens per word
    yield {
      type: 'stream_event',
      event: {
        type: 'message_delta',
        delta: { type: 'text_delta', text: word + ' ' },
        usage: { output_tokens: outputTokens },
      },
    };
    // Small delay to simulate streaming
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  // Yield assistant message with text
  yield {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: responseText }],
    },
  };

  // Yield result event with usage
  yield {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.001,
    usage: {
      input_tokens: prompt.split(' ').length,
      output_tokens: outputTokens,
    },
  };
}
