/**
 * Turn setup for session executions: everything between admission and the
 * provider call (conversation/message creation, status transition, agent
 * creation, model resolution, query-param building).
 *
 * Each `prepare*` function atomically claims execution ownership first and
 * releases that claim if setup fails before `_executeSession` takes over, so
 * a setup failure can never wedge a session. Once setup succeeds, ownership
 * belongs to the turn and is released only by `_executeSession`'s finalizer
 * after the provider generator has settled.
 */

import { sessions, messages, attachments, conversations } from '../database.js';
import { resolveAgentTypeFromModel, resolveProviderFromModel, resolveProviderMetadataFromModel, buildSessionEnv } from './sessionProvider.js';
import { checkCrossKindSwitch, reconcileAgentTypeForRun, deriveAgentTypeUpdate, isCrossKindSwitchAllowed, pendingModelClearanceForKindSwitch } from './sessionAgentGuard.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { LoggingAgentWrapper } from '../agents/LoggingAgentWrapper.js';
import { VCRAgentAdapter } from '../agents/vcr/VCRAgentAdapter.js';
import { isE2ESpawnCaptureEnabled } from './e2eSpawnCapture.js';
import { isE2EOpenAIAllowanceFixtureEnabled } from './e2eOpenAIAllowanceFixture.js';
import { getProviderAllowanceObserver } from './providerAllowanceServiceInstance.js';
import { buildAgentConfig, buildAgentEnv } from './sessionAgentConfig.js';
import { closeOwnWork } from './workflowSessionService.js';
import { normalizeFinalErrorMessage } from './visibleFinalErrorMessage.js';
import { isUserStopAbort } from './sessionAbort.js';
import { buildQueryParams } from './queryParamBuilder.js';
import { buildPromptWithAttachments } from './sessionPrompts.js';
import {
  activeConversationIds, cleanupSessionState, broadcastSessionStatus,
} from './streamEventHandler.js';
import { claimSessionExecution, isSessionExecutionConflictError } from './sessionExecutionOwnership.js';
import { buildConversationContextForModelSwitch, buildConversationContextForContinuation } from './conversationContext.js';

/** Default agent kind for sessions/rows without a stored agentType. */
const DEFAULT_AGENT_TYPE = 'claude-code';
import { ensureWorktreeCommitAttributionHook } from './gitService.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

/**
 * Create the agent for a session, using gateway + logging + VCR.
 *
 * If `config` is empty, the adapter-specific default config is applied
 * (e.g. codex receives a fresh `spawnCodexProcess` spawner). Explicit
 * `config` keys win over defaults.
 *
 * @param {string} agentType - The agent type (e.g., 'claude-code', 'codex')
 * @param {Object} [config] - Optional adapter config forwarded to the gateway.
 * @param {Object} [session] - Session row used for session-scoped adapter config.
 * @returns {{ execute: (queryParams: any, meta?: any) => AsyncGenerator }}
 */
export function createAgentForSession(agentType = DEFAULT_AGENT_TYPE, config = {}, session = null) {
  // Session-bound allowance sources tap their adapter's stream (Codex headers/
  // rollout tails, Claude rate-limit events); observation is always on.
  const allowance = ['codex', DEFAULT_AGENT_TYPE].includes(agentType) ? { allowanceObserver: getProviderAllowanceObserver() } : {};
  const mergedConfig = { ...buildAgentConfig(agentType, session), ...allowance, ...config };
  const baseAgent = agentGateway.createAgent(agentType, mergedConfig);

  // Wrap with VCR adapter if in VCR mode — except the sessions that exist to
  // execute the production adapter against the injected OpenAI allowance
  // fixture: VCR replay would bypass that adapter boundary entirely.
  const agent = process.env.VCR_MODE && !isE2ESpawnCaptureEnabled() && !isE2EOpenAIAllowanceFixtureEnabled(mergedConfig)
    ? new VCRAgentAdapter(baseAgent, { cassetteDir: 'tests/e2e/cassettes' })
    : baseAgent;

  // Always wrap with logging
  return new LoggingAgentWrapper(agent);
}

async function resolveInitialSessionModelEnv(session, model) {
  const effectiveModel = model || session.model;
  const { commitAttributionOverride = null } = resolveProviderMetadataFromModel(effectiveModel) || {};

  if (session.gitWorktree && commitAttributionOverride) {
    await ensureWorktreeCommitAttributionHook(session.gitWorktree);
  }

  const baseSessionEnv = buildSessionEnv(resolveProviderFromModel(effectiveModel), session.thinkingEnabled, session.effortLevel);
  return { effectiveModel, sessionEnv: buildAgentEnv(baseSessionEnv, commitAttributionOverride), commitAttributionOverride };
}

/**
 * Build prompt with conversation context for a continuation.
 *
 * `resumeChainGone` covers the picker-PATCH-first flow (FRD §2.2): the PATCH
 * discarded the native resume chain ahead of the turn, so the follow-up
 * carries no switch override and cannot resume. When the adapter also
 * wouldn't inject history itself, fall back to text history so the turn
 * keeps continuity instead of going out bare (FR5/G2). When the
 * conversation has no prior transcript the builder returns '' and the
 * prompt is unchanged.
 */
async function buildPromptForContinue({ modelChanged, agent, conversationId, prompt, resumeChainGone = false }) {
  if (modelChanged) {
    return buildConversationContextForModelSwitch(conversationId) + prompt;
  }
  if (agent.needsConversationContext() || resumeChainGone) {
    return buildConversationContextForContinuation(conversationId) + prompt;
  }
  return prompt;
}

/**
 * Resolve model/provider and build session environment for a continue operation.
 *
 * In-place cross-kind switch (FRD §7): when the requested model resolves to a
 * different agent kind, the switch is in scope (claude-code ↔ codex ↔ muse),
 * and the turn is interactive, the session row follows the new kind
 * ({ model, agentType, providerId }) and the turn takes the model-switch
 * context path with resume forced off. Non-interactive turns (scheduled
 * continuation, auto-send, lane runs) keep the legacy behavior exactly
 * (FR9): the model is stored but the kind is never re-derived there — only
 * the interactive message + PATCH paths allow a switch.
 */
/**
 * Apply an allowed in-place kind switch to a pending turn update: re-derive
 * the kind (+ auto providerId when it changed) and drop a stale other-kind
 * `pendingModel` override so a later scheduled fire cannot strand the row or
 * silently switch it back. A same-new-kind override stays coherent.
 */
function kindChangedUpdate(session, effectiveModel, newAgentType) {
  const update = { agentType: newAgentType };
  const newProvider = resolveProviderFromModel(effectiveModel);
  if (newProvider && newProvider.id !== session.providerId) {
    update.providerId = newProvider.id;
  }
  return { ...update, ...pendingModelClearanceForKindSwitch(session.pendingModel, newAgentType) };
}

function buildContinueModelAndEnv(session, sessionId, model, { interactive = false } = {}) {
  const effectiveModel = model || session.model;

  const provider = resolveProviderFromModel(effectiveModel);
  const providerMetadata = resolveProviderMetadataFromModel(effectiveModel);
  const commitAttributionOverride = providerMetadata?.commitAttributionOverride ?? null;
  const sessionEnv = buildAgentEnv(
    buildSessionEnv(provider, session.thinkingEnabled, session.effortLevel),
    commitAttributionOverride
  );

  const modelChanged = Boolean(model && session.model && model !== session.model);
  const { kindChanged, newAgentType } = resolveKindSwitch(session, effectiveModel, interactive, Boolean(model));

  let updatedSession = session;
  const updates = { ...(model && { model }) };
  if (kindChanged) {
    Object.assign(updates, kindChangedUpdate(session, effectiveModel, newAgentType));
  } else {
    Object.assign(
      updates,
      effectiveModel ? deriveAgentTypeUpdate(session, sessionId, effectiveModel, { providerId: session.providerId }) : {},
    );
  }
  if (Object.keys(updates).length > 0) {
    sessions.update(sessionId, updates);
    updatedSession = sessions.getById(sessionId);
  }

  return {
    effectiveModel,
    sessionEnv,
    commitAttributionOverride,
    modelChanged: modelChanged || kindChanged,
    kindChanged,
    session: updatedSession,
  };
}

/**
 * Detect an allowed in-place kind switch for a continue turn: the request
 * carried an explicit model override that resolves to a different agent
 * kind, both kinds are in scope (claude-code ↔ codex ↔ muse), and the turn
 * is interactive. A turn with no override is never a switch — even when the
 * stored model id has gone stale and falls back to 'claude-code'
 * resolution. Anything else (same kind, gemini, non-interactive) is not a
 * switch.
 * @returns {{ kindChanged: boolean, newAgentType: string }}
 */
function resolveKindSwitch(session, effectiveModel, interactive, hasExplicitModel = false) {
  const currentAgentType = session.agentType || DEFAULT_AGENT_TYPE;
  const newAgentType = effectiveModel ? resolveAgentTypeFromModel(effectiveModel) : currentAgentType;
  const kindChanged = Boolean(effectiveModel)
    && hasExplicitModel
    && newAgentType !== currentAgentType
    && isCrossKindSwitchAllowed(currentAgentType, effectiveModel)
    && interactive;
  return { kindChanged, newAgentType };
}

/**
 * Build query params and agent call meta for a continue session operation.
 */
async function buildContinueParams({
  sessionId, session, systemPrompt, effectiveModel, sessionEnv,
  modelChanged, activeConversation, promptWithAttachments,
  workingDirectory, controller, agentType, agent, commitAttributionOverride,
}) {
  const canResume = activeConversation.claudeSessionId && !modelChanged && agent.supportsResume();

  // The native chain is gone but the turn detects no switch (picker-PATCH
  // cleared it ahead of time) and the adapter won't self-supply history:
  // inject text history instead of going out bare. Same-kind resumes
  // (canResume) and switch-detected turns (modelChanged) never reach here.
  const resumeChainGone = !modelChanged && !canResume && !agent.needsConversationContext();

  const promptWithContext = await buildPromptForContinue({
    modelChanged, agent, conversationId: activeConversation.id, prompt: promptWithAttachments,
    resumeChainGone,
  });

  const queryParams = buildQueryParams({
    prompt: promptWithContext,
    workingDirectory,
    controller,
    session,
    sessionId,
    systemPrompt,
    model: effectiveModel,
    sessionEnv,
    conversationId: activeConversation.id,
    resumeSessionId: canResume ? activeConversation.claudeSessionId : null,
    agentType,
    commitAttributionOverride,
  });
  const agentCallMeta = {
    sessionId,
    conversationId: activeConversation.id,
    callType: 'continueSession',
    agentType,
    model: effectiveModel,
    effortLevel: session.effortLevel,
    isResume: canResume,
    promptLength: promptWithContext.length,
  };

  return { queryParams, agentCallMeta };
}

/**
 * Set up the active conversation, create the user message, broadcast it,
 * associate attachments, and build the prompt with attachment context.
 * @returns {{ activeConversation: Object, promptWithAttachments: string }}
 */
async function setupConversationAndMessage(sessionId, content, fileAttachments) {
  const activeConversation = conversations.ensureActiveConversation(sessionId);
  activeConversationIds.set(sessionId, activeConversation.id);

  const message = messages.create(sessionId, 'user', content, { toolUse: null, conversationId: activeConversation.id });

  // Touch the session to update its updated_at timestamp so it sorts to the top
  sessions.touch(sessionId);

  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
    message,
    conversationId: activeConversation.id,
  });

  if (fileAttachments.length > 0) {
    attachments.updateMessageIdForSession(sessionId, message.id);
  }

  const promptWithAttachments = buildPromptWithAttachments(content, fileAttachments);
  return { activeConversation, promptWithAttachments };
}

/**
 * Claim ownership and prepare a continuation turn.
 * @returns {{ session: Object, queryParams: Object, agentCallMeta: Object, agent: Object }}
 */
export async function prepareContinueTurn({ session, sessionId, content, workingDirectory, options, controller }) {
  const { systemPrompt = null, fileAttachments = [], model = null, interactive = false } = options;
  // Fail closed on cross-kind model overrides for non-interactive turns
  // (FR9/N4): only the interactive message + PATCH paths allow a switch, so
  // a scheduler/auto-send/lane-run override (via pendingModel) that crosses
  // kinds is rejected with the existing CROSS_KIND_MODEL_SWITCH semantics
  // BEFORE claiming execution or writing anything — no model/agentType
  // update, no adapter creation, no user message. Mirrors the
  // branch-continue guard: only enforced for positively-known models, so an
  // unregistered id (no kind information) stays on the legacy path.
  if (!interactive && model && resolveProviderFromModel(model)) {
    const crossKindError = checkCrossKindSwitch(session, model);
    if (crossKindError) {
      throw Object.assign(new Error(crossKindError.message), { code: crossKindError.error, statusCode: 400 });
    }
  }
  // Single atomic admission gate: a live turn — running or still shutting
  // down after a Stop — owns the session until its finalizer releases it.
  claimSessionExecution(sessionId, controller);
  try {
    const { activeConversation, promptWithAttachments } = await setupConversationAndMessage(
      sessionId, content, fileAttachments
    );

    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Resolve the effective model/kind BEFORE creating the adapter, so an
    // allowed in-place switch runs on the NEW adapter with rebuilt env.
    const modelEnv = buildContinueModelAndEnv(session, sessionId, model, { interactive });
    const currentSession = modelEnv.session;
    if (currentSession.gitWorktree && modelEnv.commitAttributionOverride) {
      await ensureWorktreeCommitAttributionHook(currentSession.gitWorktree);
    }

    // A kind switch discards the old native resume chain (FR4): never send
    // resume, and clear the stored pointer so later turns can't reuse it.
    if (modelEnv.kindChanged) {
      conversations.update(activeConversation.id, { claudeSessionId: null });
      activeConversation.claudeSessionId = null;
    }

    const agentType = currentSession.agentType || DEFAULT_AGENT_TYPE;
    const agent = createAgentForSession(agentType, {}, currentSession);

    const { queryParams, agentCallMeta } = await buildContinueParams({
      sessionId, session: currentSession, systemPrompt,
      effectiveModel: modelEnv.effectiveModel, sessionEnv: modelEnv.sessionEnv,
      commitAttributionOverride: modelEnv.commitAttributionOverride,
      modelChanged: modelEnv.modelChanged, activeConversation, promptWithAttachments,
      workingDirectory, controller, agentType, agent,
    });
    return { session: currentSession, queryParams, agentCallMeta, agent };
  } catch (error) {
    // Setup failed before _executeSession took over: release this turn's
    // claim (including its conversation mapping) so the session is usable.
    cleanupSessionState(sessionId, true, controller);
    throw error;
  }
}

/**
 * Prepare the shared per-start state for runSessionCore: register the abort
 * controller, ensure the active conversation, flip the session to 'running',
 * attach any pending file attachments, and build the final prompt. Lives here
 * (not in sessionExecution.js) so the execution module stays within its
 * lifecycle size budget — this is turn preparation, which this module owns.
 *
 * @returns {{ session: Object, activeConversation: Object, promptWithAttachments: string }}
 */
export function beginSessionStart(sessionId, prompt, { model, providerId, fileAttachments, controller }) {
  // Single atomic admission gate, shared by the standard and tier-bound
  // initial-start paths: a live turn — running or still shutting down after
  // a Stop — owns the session until its finalizer releases it. Throws a
  // 409-coded conflict instead of replacing the live controller.
  claimSessionExecution(sessionId, controller);

  // Get the active conversation for this session (created in SessionRepository.create)
  const activeConversation = conversations.ensureActiveConversation(sessionId);
  activeConversationIds.set(sessionId, activeConversation.id);

  // Update status to running and track the user-requested model (short format) on the session
  sessions.update(sessionId, { status: 'running', ...(model && { model, providerId: providerId ?? null }) });
  broadcastSessionStatus(sessionId, 'running');

  // Note: Initial user message is already created in SessionRepository.create()
  // Associate any pending attachments with the initial message
  const initialMessage = messages.getBySessionId(sessionId)[0];
  if (initialMessage && fileAttachments.length > 0) {
    attachments.updateMessageIdForSession(sessionId, initialMessage.id);
  }

  return {
    session: sessions.getById(sessionId),
    activeConversation,
    promptWithAttachments: buildPromptWithAttachments(prompt, fileAttachments),
  };
}

/**
 * Claim ownership and prepare an initial-run turn.
 * @returns {{ session: Object, queryParams: Object, agentCallMeta: Object, agent: Object, activeConversation: Object }}
 */
export async function prepareRunTurn({ session, sessionId, prompt, workingDirectory, options, controller }) {
  const { systemPrompt = null, fileAttachments = [], model = null } = options;
  claimSessionExecution(sessionId, controller);
  try {
    // Get the active conversation for this session (created in SessionRepository.create)
    const activeConversation = conversations.ensureActiveConversation(sessionId);
    activeConversationIds.set(sessionId, activeConversation.id);

    // Update status to running and track the user-requested model (short format) on the session
    sessions.update(sessionId, { status: 'running', ...(model && { model }) });
    let currentSession = sessions.getById(sessionId) || session;
    broadcastSessionStatus(sessionId, 'running');

    // Note: Initial user message is already created in SessionRepository.create()
    // Associate any pending attachments with the initial message
    const initialMessage = messages.getBySessionId(sessionId)[0];
    if (initialMessage && fileAttachments.length > 0) {
      attachments.updateMessageIdForSession(sessionId, initialMessage.id);
    }

    // Build prompt with attachment context
    const promptWithAttachments = buildPromptWithAttachments(prompt, fileAttachments);

    // Defense in depth: re-derive and persist the correct agent kind before creating
    // the adapter — self-heals legacy corrupted rows and any entry point that
    // bypasses the PATCH guard.
    currentSession = reconcileAgentTypeForRun(currentSession, sessionId, model);

    // Create agent via gateway (or mock agent in mock mode)
    const agentType = currentSession.agentType || DEFAULT_AGENT_TYPE;
    const agent = createAgentForSession(agentType, {}, currentSession);

    const { effectiveModel, sessionEnv, commitAttributionOverride } =
      await resolveInitialSessionModelEnv(currentSession, model);

    const queryParams = buildQueryParams({
      prompt: promptWithAttachments,
      workingDirectory,
      controller,
      session: currentSession,
      sessionId,
      systemPrompt,
      model: effectiveModel,
      sessionEnv,
      conversationId: activeConversation.id,
      agentType,
      commitAttributionOverride,
    });

    console.log(`[SessionManager] runSession: model=${queryParams.options?.model || '[default]'} baseUrl=${queryParams.options?.env?.ANTHROPIC_BASE_URL || '[not set]'}`);
    const agentCallMeta = {
      sessionId,
      conversationId: activeConversation.id,
      callType: 'runSession',
      agentType,
      model,
      effortLevel: currentSession.effortLevel,
      promptLength: promptWithAttachments.length,
    };
    return { session: currentSession, queryParams, agentCallMeta, agent, activeConversation };
  } catch (error) {
    // Setup failed before _executeSession took over: release this turn's claim.
    cleanupSessionState(sessionId, false, controller);
    throw error;
  }
}

/**
 * Fail a turn whose preparation (ownership registration, conversation/message
 * setup, model resolution, agent construction, query-param building) threw
 * BEFORE provider dispatch — i.e. outside `_executeSession`'s own
 * error/finally boundary. Surfaces a sanitized visible error, moves the
 * session to error status, fails an owned lane obligation instead of
 * stranding it, and releases active state with controller fencing so a newer
 * turn is never erased. Always rethrows so callers still observe the failure.
 *
 * A user stop is not a permanent error: stopSession() already set the status
 * to 'stopped' and paused any open lane obligation, so this path must not
 * overwrite that state or fail the run — it only releases this turn's claim
 * and rethrows.
 *
 * @param {Object} args
 * @param {string} args.sessionId
 * @param {AbortController} args.controller - This turn's controller (fencing).
 * @param {unknown} args.error - The preparation failure.
 * @param {boolean} [args.includeConversationId=true] - Whether a conversation
 *   registration may have been created during preparation.
 */
export function handlePreparationFailure({ sessionId, controller, error, includeConversationId = true }) {
  if (isUserStopAbort(controller)) {
    cleanupSessionState(sessionId, includeConversationId, controller);
    throw error;
  }
  const sanitizedError = normalizeFinalErrorMessage(error);
  sessions.update(sessionId, { status: 'error', error: sanitizedError });
  broadcastSessionStatus(sessionId, 'error');
  closeOwnWork(sessionId, 'closed_failed', sanitizedError);
  cleanupSessionState(sessionId, includeConversationId, controller);
  throw error;
}

/**
 * Admit an initial session start through the shared atomic boundary.
 * Claims execution ownership before any start mutation (both the standard
 * and tier-bound start paths enter here), then builds the shared per-start
 * state.
 *
 * A claim conflict is a pure admission rejection — no mutation happened for
 * this start — so it rethrows untouched, without setting error state,
 * closing workflow, or cleaning up the live turn. Any other preparation
 * failure after registration fails the turn explicitly through the shared
 * preparation-failure path so the session is neither wedged nor stranded.
 *
 * @returns {{ session: Object, activeConversation: Object, promptWithAttachments: string }}
 */
export function admitSessionStart(sessionId, prompt, { model, providerId, fileAttachments, controller }) {
  try {
    return beginSessionStart(sessionId, prompt, { model, providerId, fileAttachments, controller });
  } catch (error) {
    if (isSessionExecutionConflictError(error)) throw error;
    handlePreparationFailure({ sessionId, controller, error, includeConversationId: false });
  }
}
