import { createCodexEventMapper } from './codexEventMapper.js';
import { CodexAppServerClient } from './CodexAppServerClient.js';
import { encodeError, encodeUserInputResponse, normalizeUserInputRequest } from './codexAppServerCodec.js';
import { invalidateInteraction, requestInteraction } from '../../services/promptStore.js';
import { createCodexSpawner } from '../../services/codexSpawnHelper.js';
import { buildCodexExecutionConfig } from './codexExecutionConfig.js';
import logger from '../../logger.js';
import { randomUUID } from 'crypto';

export async function *spawnCodexAppServer(spawnOverride, queryParams, options, meta) {
  const spawn = spawnOverride ?? createCodexSpawner();
  const config = buildCodexExecutionConfig(options);
  const child = spawn({ command: 'codex', args: ['app-server', ...config.configArgs], cwd: config.cwd, env: config.env, signal: config.signal });
  yield* executeCodexAppServer(child, queryParams, options, meta || { sessionId: options.sessionId, conversationId: options.conversationId }, config);
}

// Runs one persistent App Server connection for a single execution. The
// adapter owns spawning; this module owns only protocol-to-event translation.
// eslint-disable-next-line max-params, max-lines-per-function, max-statements -- connection lifecycle, callbacks, and cleanup share one ownership boundary.
export async function *executeCodexAppServer(child, queryParams, options, meta = {}, resolvedConfig = buildCodexExecutionConfig(options)) {
  const events = []; let wake; let done = false; let failure;
  const handledServerRequests = new Set();
  const connectionId = randomUUID();
  let activeThreadId = null;
  const interactionController = new AbortController();
  const abortInteractions = (reason) => {
    if (!interactionController.signal.aborted) interactionController.abort(reason);
  };
  const fail = (error) => {
    if (failure || done) return;
    failure = error instanceof Error ? error : new Error(String(error));
    logger.error('Codex App Server execution failed', {
      sessionId: meta.sessionId,
      outstandingServerRequests: handledServerRequests.size,
    });
    abortInteractions(failure);
    wake?.();
  };
  logger.log('Codex App Server startup', {
    sessionId: meta.sessionId,
    conversationId: meta.conversationId,
  });
  const onAbort = () => {
    const error = options.abortController.signal.reason || new Error('Codex App Server turn aborted');
    // Close first: request waiters then settle locally, but must not write a
    // cancellation-shaped response to an interrupted provider connection.
    client?.close(error);
    fail(error);
  };
  options.abortController?.signal?.addEventListener('abort', onAbort, { once: true });
  const mapper = createCodexEventMapper({ model: options.model });
  const push = (items) => { events.push(...items); wake?.(); wake = null; };
  const client = new CodexAppServerClient({
    child,
    onClose: fail,
    onNotification: handleNotification,
    onServerRequest: handleServerRequest,
  });
  async function handleNotification(message) {
      if (message.method === 'serverRequest/resolved') {
        const id = message.params?.requestId ?? message.params?.id;
        const invalidated = invalidateInteraction({
          sessionId: meta.sessionId,
          provider: 'codex',
          externalRequestId: id,
          metadata: { connectionId, threadId: activeThreadId },
        });
        if (!invalidated) logger.log('Codex App Server unknown request resolution', { sessionId: meta.sessionId, requestId: String(id) });
        return;
      }
      if (message.method === 'turn/failed') throw new Error(message.params?.error?.message || 'Codex turn failed');
      if (message.method === 'error') throw new Error(message.params?.message || 'Codex App Server protocol error');
      if (message.method === 'turn/completed') { push(mapper.map({ type: 'turn.completed', usage: message.params?.turn?.usage })); done = true; wake?.(); return; }
      if (message.method === 'item/completed') push(mapper.map({ type: 'item.completed', item: message.params?.item }));
  }
  async function handleServerRequest(request) {
      if (request.method !== 'item/tool/requestUserInput') return client.respondError(request.id, -32601, 'Unsupported server request');
      try {
        const { responseContext, ...normalized } = normalizeUserInputRequest(request);
        // One runner owns one App Server connection; thread plus request id is
        // therefore the provider-request identity within this connection.
        const identity = serverRequestIdentity(normalized.metadata.threadId, request.id);
        if (handledServerRequests.has(identity)) {
          logger.log('Codex App Server duplicate user-input request', { sessionId: meta.sessionId, requestId: String(request.id) });
          return;
        }
        handledServerRequests.add(identity);
        logger.log('Codex App Server user-input request received', {
          sessionId: meta.sessionId,
          conversationId: meta.conversationId,
          requestId: String(request.id),
          threadId: normalized.metadata.threadId,
          turnId: normalized.metadata.turnId,
          questionCount: normalized.payload.questions.length,
        });
        const outcome = await requestInteraction({
          sessionId: meta.sessionId, conversationId: meta.conversationId, provider: 'codex', kind: 'question',
          ...normalized,
          metadata: { ...normalized.metadata, connectionId },
          signal: interactionController.signal, expiryMs: interactionExpiryMs(options),
        });
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
  }
  try {
    try {
      await client.initialize();
    } catch (error) {
      logger.error('Codex App Server initialization failed', {
        sessionId: meta.sessionId,
        compatibility: error?.message?.startsWith('Codex App Server is incompatible:') || false,
      });
      throw error;
    }
    logger.log('Codex App Server initialized', { sessionId: meta.sessionId });
    options.onInteractiveInputAvailable?.();
    const thread = await client.request('thread/start', { cwd: resolvedConfig.cwd, model: resolvedConfig.model, sandbox: resolvedConfig.sandbox, developerInstructions: resolvedConfig.systemPrompt });
    const threadId = thread?.thread?.id;
    if (!threadId) throw new Error('Codex App Server did not return a thread id');
    activeThreadId = threadId;
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

function serverRequestIdentity(threadId, requestId) {
  return JSON.stringify([threadId, requestId]);
}

function interactionExpiryMs({ interactionTimeoutMs }) {
  return Number.isFinite(interactionTimeoutMs) && interactionTimeoutMs >= 0
    ? interactionTimeoutMs
    : undefined;
}
