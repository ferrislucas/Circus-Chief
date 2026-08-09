import { Router } from 'express';
import {
  ClaimScheduledRequest,
  CreateMessageRequest,
  GetDueSessionsQuery,
  ProjectIdParams,
  SessionIdParams,
  ConversationIdParams,
  SHARED_DATA_API_VERSION,
  SharedDataErrorResponse,
  UpdateAttachmentMessageRequest,
  UpdateSessionRequest,
} from '@circuschief/shared';
import { LocalDataStore, SharedDataError } from '../services/sharedDataStore.js';

const router = Router();
const store = new LocalDataStore();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new SharedDataError('VALIDATION_ERROR', 'Invalid request', result.error.flatten());
  return result.data;
}

function sendError(res, error) {
  const status = error?.code === 'VALIDATION_ERROR' ? 400
    : error?.code === 'NOT_FOUND' ? 404
      : error?.code === 'CONFLICT' ? 409 : 500;
  const body = SharedDataErrorResponse.parse({
    code: error?.code || 'INTERNAL_ERROR', message: error?.message || 'Internal error', details: error?.details,
  });
  res.status(status).json(body);
}

function route(handler) {
  return async (req, res) => {
    try { res.json(await handler(req)); } catch (error) { sendError(res, error); }
  };
}

async function required(value, label) {
  if (!value) throw new SharedDataError('NOT_FOUND', `${label} not found`);
  return value;
}

router.get('/health', (_req, res) => res.json({ ok: true }));
router.get('/version', (_req, res) => res.json({ version: SHARED_DATA_API_VERSION, capabilities: ['sessions', 'messages', 'conversations', 'attachments'] }));
router.get('/sessions/due', route(async (req) => store.sessions.getScheduledDue(parse(GetDueSessionsQuery, req.query).now)));
router.get('/sessions/:sessionId', route(async (req) => required(await store.sessions.getById(parse(SessionIdParams, req.params).sessionId), 'Session')));
router.patch('/sessions/:sessionId', route(async (req) => required(await store.sessions.update(parse(SessionIdParams, req.params).sessionId, parse(UpdateSessionRequest, req.body)), 'Session')));
router.post('/sessions/:sessionId/claim-scheduled', route(async (req) => {
  const { sessionId } = parse(SessionIdParams, req.params);
  const { expectedScheduledAt, claimedAt } = parse(ClaimScheduledRequest, req.body);
  return store.sessions.claimScheduled(sessionId, expectedScheduledAt, claimedAt);
}));
router.get('/projects/:projectId', route(async (req) => required(await store.projects.getById(parse(ProjectIdParams, req.params).projectId), 'Project')));
router.get('/sessions/:sessionId/messages', route(async (req) => store.messages.getBySessionId(parse(SessionIdParams, req.params).sessionId)));
router.get('/conversations/:conversationId/messages', route(async (req) => store.messages.getByConversationId(parse(ConversationIdParams, req.params).conversationId)));
router.post('/messages', route(async (req) => {
  const { sessionId, role, content, toolUse, conversationId, model } = parse(CreateMessageRequest, req.body);
  return store.messages.create(sessionId, role, content, { toolUse, conversationId, model });
}));
router.get('/sessions/:sessionId/active-conversation', route(async (req) => required(await store.conversations.getActiveBySessionId(parse(SessionIdParams, req.params).sessionId), 'Active conversation')));
router.get('/sessions/:sessionId/attachments', route(async (req) => store.attachments.getBySessionId(parse(SessionIdParams, req.params).sessionId)));
router.patch('/sessions/:sessionId/attachments/message', route(async (req) => {
  const { sessionId } = parse(SessionIdParams, req.params);
  const { messageId } = parse(UpdateAttachmentMessageRequest, req.body);
  await store.attachments.updateMessageIdForSession(sessionId, messageId);
  return { ok: true };
}));

export default router;
