import { BaseAgent } from '../BaseAgent.js';
import { composeCliPrompt } from './cliUtils.js';
import { GrokAcpClient } from './grokAcpClient.js';
import {
  configOptionIds,
  createGrokAcpEventMapper,
  currentModelFromInitialize,
  grokEffortValue,
  modelsFromInitialize,
} from './grokAcpEventMapper.js';
import { answerGrokQuestion } from './grokQuestionBridge.js';
import { answerGrokPlanApproval } from './grokPlanBridge.js';
import { observeGrokBilling } from './grokBilling.js';
import { rememberGrokModels } from '../../services/grokBuildDiscovery.js';

/**
 * Grok Build over ACP (`grok --no-auto-update agent stdio`).
 *
 * One child per Circus session. Login stays in the user's Grok CLI
 * (`cached_token`). Tool approval is always-approve (`yoloMode`); deny
 * rules and hooks still belong to Grok. Client filesystem and terminal
 * capabilities are not advertised.
 */
export class GrokBuildAcpAdapter extends BaseAgent {
  static capabilities = Object.freeze({
    streaming: true,
    thinking: false,
    reasoningEffort: true,
    toolUse: true,
    resume: true,
  });

  constructor({ spawnImpl, rememberModels = rememberGrokModels, allowanceObserver = null, clock = Date, ...rest } = {}) {
    super(rest);
    this._spawnImpl = spawnImpl;
    this._rememberModels = rememberModels;
    this._allowanceObserver = allowanceObserver;
    this._clock = clock;
  }

  getCapabilities() {
    return { ...GrokBuildAcpAdapter.capabilities };
  }

  supportsResume() {
    return true;
  }

  async *execute(queryParams) {
    const options = queryParams.options || {};
    if (!options.cwd) {
      throw codedError('Grok Build requires a working directory.', 'GROK_NO_CWD');
    }
    const turn = openGrokTurn(this, options);
    const { mapper, queue, client } = turn;
    let nativeId = null;
    try {
      const init = await client.start();
      this._rememberModels(modelsFromInitialize(init));
      const opened = await openSession(client, options, init);
      turn.beginUpdates();
      nativeId = opened.sessionId;
      client.sessionId = nativeId;
      const model = await applySessionConfig({
        client,
        sessionId: nativeId,
        options,
        init,
        session: opened.session,
      });
      queue.push({ type: 'system', subtype: 'init', session_id: nativeId, model });
      const prompt = client.request('session/prompt', {
        sessionId: nativeId,
        prompt: [{ type: 'text', text: composeCliPrompt(options.systemPrompt, queryParams.prompt) }],
      }).then((result) => {
        for (const event of mapper.finish(result, nativeId, { permissionCancelled: client.permissionCancelled })) queue.push(event);
        queue.end();
      }).catch((error) => queue.fail(error));
      yield* queue.events();
      await prompt;
    } catch (error) {
      if (options.resume && !nativeId) {
        yield { type: 'system', subtype: 'init', session_id: null, model: options.model };
      }
      throw error;
    } finally {
      if (!options.abortController?.signal?.aborted) {
        await observeGrokBilling(client, {
          observer: this._allowanceObserver,
          providerId: options.providerId,
          clock: this._clock,
        });
      }
      if (options.abortController?.signal?.aborted) await client.cancelActive(nativeId);
      await client.shutdown();
    }
  }
}

function openGrokTurn(adapter, options) {
  const mapper = createGrokAcpEventMapper();
  const queue = createEventQueue();
  const client = new GrokAcpClient({
    spawnImpl: adapter._spawnImpl,
    cwd: options.cwd,
    env: options.env,
    signal: options.abortController?.signal,
    onQuestion: (request) => answerGrokQuestion({
      sessionId: options.sessionId,
      conversationId: options.conversationId,
      request,
      signal: options.abortController?.signal,
    }),
    onPlanApproval: (request) => answerGrokPlanApproval({
      sessionId: options.sessionId,
      conversationId: options.conversationId,
      request,
      signal: options.abortController?.signal,
    }),
  });
  let live = false;
  client.onNotification = (message) => {
    if (!live || message.method !== 'session/update') return;
    for (const event of mapper.mapUpdate(message.params)) queue.push(event);
  };
  return {
    mapper,
    queue,
    client,
    beginUpdates() { live = true; },
  };
}

async function openSession(client, options, init) {
  const cwd = options.cwd;
  const base = { cwd, mcpServers: [] };
  if (options.resume) {
    if (!init?.agentCapabilities?.loadSession) {
      throw codedError('This Grok Build version cannot restore a session. Start a new Grok session.', 'GROK_RESUME_UNSUPPORTED');
    }
    try {
      const session = await client.request('session/load', { ...base, sessionId: options.resume });
      return { sessionId: options.resume, session };
    } catch (error) {
      throw codedError(
        `Grok could not restore this session. Start a new Grok session. ${error.message || ''}`.trim(),
        'GROK_RESUME_FAILED',
      );
    }
  }
  const session = await client.request('session/new', { ...base, _meta: { yoloMode: true } });
  if (!session?.sessionId) throw codedError('Grok Build did not return a session id.', 'GROK_NO_SESSION');
  return { sessionId: session.sessionId, session };
}

async function applySessionConfig({ client, sessionId, options, init, session }) {
  const ids = configOptionIds(session);
  const current = currentModelFromInitialize(init);
  let model = options.model || current || undefined;
  if (options.model && ids.has('model') && options.model !== current) {
    await client.request('session/set_config_option', {
      sessionId,
      configId: 'model',
      value: options.model,
    });
    model = options.model;
  }
  const effort = grokEffortValue(options.effortLevel);
  if (effort && ids.has('reasoning_effort')) {
    await client.request('session/set_config_option', {
      sessionId,
      configId: 'reasoning_effort',
      value: effort,
    });
  }
  return model;
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createEventQueue() {
  const pending = [];
  let resolveNext = null;
  let ended = false;
  let failure = null;

  function wake() {
    if (!resolveNext) return;
    const resolve = resolveNext;
    resolveNext = null;
    resolve();
  }

  return {
    push(event) {
      pending.push(event);
      wake();
    },
    end() {
      ended = true;
      wake();
    },
    fail(error) {
      failure = error;
      ended = true;
      wake();
    },
    async *events() {
      for (;;) {
        if (pending.length) {
          yield pending.shift();
          continue;
        }
        if (failure) throw failure;
        if (ended) return;
        await new Promise((resolve) => { resolveNext = resolve; });
      }
    },
  };
}
