import { createCodexEventMapper } from './codexEventMapper.js';
import { CodexAppServerClient } from './CodexAppServerClient.js';
import { encodeError, encodeUserInputResponse, normalizeUserInputRequest } from './codexAppServerCodec.js';
import { invalidateInteraction, requestInteraction } from '../../services/promptStore.js';
import { createCodexSpawner } from '../../services/codexSpawnHelper.js';

export async function *spawnCodexAppServer(spawnOverride, queryParams, options, meta) {
  const spawn = spawnOverride ?? createCodexSpawner();
  const child = spawn({ command: 'codex', args: ['app-server'], cwd: options.cwd, env: options.env, signal: options.abortController?.signal });
  yield* executeCodexAppServer(child, queryParams, options, meta || { sessionId: options.sessionId, conversationId: options.conversationId });
}

// Runs one persistent App Server connection for a single execution. The
// adapter owns spawning; this module owns only protocol-to-event translation.
export async function *executeCodexAppServer(child, queryParams, options, meta = {}) {
  const events = []; let wake; let done = false; let failure;
  const mapper = createCodexEventMapper({ model: options.model });
  const push = (items) => { events.push(...items); wake?.(); wake = null; };
  const client = new CodexAppServerClient({
    child,
    onNotification: async (message) => {
      if (message.method === 'serverRequest/resolved') {
        const id = message.params?.requestId ?? message.params?.id;
        invalidateInteraction({ sessionId: meta.sessionId, provider: 'codex', externalRequestId: id });
        return;
      }
      if (message.method === 'turn/completed') { push(mapper.map({ type: 'turn.completed', usage: message.params?.turn?.usage })); done = true; wake?.(); return; }
      if (message.method === 'item/completed') push(mapper.map({ type: 'item.completed', item: message.params?.item }));
    },
    onServerRequest: async (request) => {
      if (request.method !== 'item/tool/requestUserInput') return client.respondError(request.id, -32601, 'Unsupported server request');
      try {
        const normalized = normalizeUserInputRequest(request);
        const outcome = await requestInteraction({ sessionId: meta.sessionId, conversationId: meta.conversationId, provider: 'codex', kind: 'question', ...normalized, signal: options.abortController?.signal });
        client.respond(request.id, encodeUserInputResponse(request.id, outcome).result);
      } catch (error) {
        const response = encodeError(request.id, -32602, error instanceof Error ? error.message : 'Invalid user-input request');
        client.respondError(response.id, response.error.code, response.error.message);
      }
    },
  });
  try {
    await client.initialize();
    const thread = await client.request('thread/start', { cwd: options.cwd, model: options.model, sandbox: options.sandboxMode, developerInstructions: options.systemPrompt || null });
    const threadId = thread?.thread?.id;
    if (!threadId) throw new Error('Codex App Server did not return a thread id');
    await client.request('turn/start', { threadId, input: [{ type: 'text', text: queryParams.prompt }], cwd: options.cwd, model: options.model, effort: options.effortLevel || null });
    while (!done) {
      if (failure) throw failure;
      if (events.length) { yield events.shift(); continue; }
      await new Promise((resolve) => { wake = resolve; });
    }
    while (events.length) yield events.shift();
  } finally {
    client.close();
    try { child.kill('SIGTERM'); } catch { /* child already exited */ }
  }
}
