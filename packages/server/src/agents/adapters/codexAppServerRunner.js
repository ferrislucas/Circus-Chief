import { createCodexEventMapper } from './codexEventMapper.js';
import { CodexAppServerClient } from './CodexAppServerClient.js';
import { encodeError, encodeUserInputResponse, normalizeUserInputRequest } from './codexAppServerCodec.js';
import { invalidateInteraction, requestInteraction } from '../../services/promptStore.js';
import { createCodexSpawner } from '../../services/codexSpawnHelper.js';
import { buildCodexExecutionConfig } from './codexExecutionConfig.js';

export async function *spawnCodexAppServer(spawnOverride, queryParams, options, meta) {
  const spawn = spawnOverride ?? createCodexSpawner();
  const config = buildCodexExecutionConfig(options);
  const child = spawn({ command: 'codex', args: ['app-server', ...config.configArgs], cwd: config.cwd, env: config.env, signal: config.signal });
  yield* executeCodexAppServer(child, queryParams, options, meta || { sessionId: options.sessionId, conversationId: options.conversationId }, config);
}

// Runs one persistent App Server connection for a single execution. The
// adapter owns spawning; this module owns only protocol-to-event translation.
export async function *executeCodexAppServer(child, queryParams, options, meta = {}, resolvedConfig = buildCodexExecutionConfig(options)) {
  const events = []; let wake; let done = false; let failure;
  const interactionController = new AbortController();
  const abortInteractions = (reason) => {
    if (!interactionController.signal.aborted) interactionController.abort(reason);
  };
  const fail = (error) => {
    if (failure || done) return;
    failure = error instanceof Error ? error : new Error(String(error));
    abortInteractions(failure);
    wake?.();
  };
  const onAbort = () => fail(options.abortController.signal.reason || new Error('Codex App Server turn aborted'));
  options.abortController?.signal?.addEventListener('abort', onAbort, { once: true });
  const mapper = createCodexEventMapper({ model: options.model });
  const push = (items) => { events.push(...items); wake?.(); wake = null; };
  const client = new CodexAppServerClient({
    child,
    onClose: fail,
    onNotification: async (message) => {
      if (message.method === 'serverRequest/resolved') {
        const id = message.params?.requestId ?? message.params?.id;
        invalidateInteraction({ sessionId: meta.sessionId, provider: 'codex', externalRequestId: id });
        return;
      }
      if (message.method === 'turn/failed') throw new Error(message.params?.error?.message || 'Codex turn failed');
      if (message.method === 'error') throw new Error(message.params?.message || 'Codex App Server protocol error');
      if (message.method === 'turn/completed') { push(mapper.map({ type: 'turn.completed', usage: message.params?.turn?.usage })); done = true; wake?.(); return; }
      if (message.method === 'item/completed') push(mapper.map({ type: 'item.completed', item: message.params?.item }));
    },
    onServerRequest: async (request) => {
      if (request.method !== 'item/tool/requestUserInput') return client.respondError(request.id, -32601, 'Unsupported server request');
      try {
        const { responseContext, ...normalized } = normalizeUserInputRequest(request);
        const outcome = await requestInteraction({ sessionId: meta.sessionId, conversationId: meta.conversationId, provider: 'codex', kind: 'question', ...normalized, signal: interactionController.signal });
        if (client.closed) return;
        // The provider has already resolved this request, so its matching
        // notification invalidated the local prompt. It expects no response.
        if (outcome?.action === 'invalidated') return;
        client.respond(request.id, encodeUserInputResponse(responseContext, outcome).result);
      } catch (error) {
        if (client.closed) return;
        const response = encodeError(request.id, -32602, error instanceof Error ? error.message : 'Invalid user-input request');
        client.respondError(response.id, response.error.code, response.error.message);
      }
    },
  });
  try {
    await client.initialize();
    const thread = await client.request('thread/start', { cwd: resolvedConfig.cwd, model: resolvedConfig.model, sandbox: resolvedConfig.sandbox, developerInstructions: resolvedConfig.systemPrompt });
    const threadId = thread?.thread?.id;
    if (!threadId) throw new Error('Codex App Server did not return a thread id');
    await client.request('turn/start', { threadId, input: [{ type: 'text', text: queryParams.prompt }], cwd: resolvedConfig.cwd, model: resolvedConfig.model, effort: resolvedConfig.reasoningEffort });
    while (!done) {
      if (failure) throw failure;
      if (events.length) { yield events.shift(); continue; }
      await new Promise((resolve) => { wake = resolve; });
    }
    while (events.length) yield events.shift();
  } finally {
    options.abortController?.signal?.removeEventListener('abort', onAbort);
    abortInteractions(new Error('Codex App Server turn closed'));
    client.close();
    try { child.kill('SIGTERM'); } catch { /* child already exited */ }
  }
}
