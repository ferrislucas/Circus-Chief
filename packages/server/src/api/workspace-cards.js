/**
 * Workspace-card helpers shared by the list (`view=cards`) and detail/`/card`
 * endpoints in workspaces.js. Split out into their own module to keep
 * workspaces.js within the project's file line budget.
 */

import { sessions, commandRuns } from '../database.js';
import { commandRunner } from '../services/commandRunner.js';
import { buildRunsBySession } from './projects-helpers.js';
import { hasPendingPrompt } from '../services/promptStore.js';
import { isValidWorkspaceCardCursor } from '../db/workspace-queries.js';

// These timings are intentionally response headers rather than a metrics sink:
// they are production-safe, immediately visible in browser waterfalls, and keep
// the list/detail contract measurable without recording user content.
export function sendWorkspaceJson(res, payload, startedAt) {
  const serializeStartedAt = performance.now();
  const body = JSON.stringify(payload);
  const serializationMs = performance.now() - serializeStartedAt;
  const totalMs = performance.now() - startedAt;
  res.append('Access-Control-Expose-Headers', 'Server-Timing, X-Response-Bytes');
  res.set({
    'Server-Timing': `workspace;dur=${totalMs.toFixed(1)}, serialize;dur=${serializationMs.toFixed(1)}`,
    'X-Response-Bytes': String(Buffer.byteLength(body)),
  });
  return res.type('application/json').send(body);
}

function parseBooleanFilter(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function hasValidWorkspaceCardFilters(status, scheduled) {
  return (
    ['running', 'waiting', 'idle', undefined].includes(status) &&
    ['true', 'false', undefined].includes(scheduled)
  );
}

function hasValidWorkspaceCardPagination(limit, offset) {
  return (
    Number.isInteger(limit) && limit >= 1 && limit <= 500 && Number.isInteger(offset) && offset >= 0
  );
}

function parseWorkspaceCardOptions({ archived, starred, limit, cursor, status, scheduled }) {
  const isNonNegativeInt = (value) => typeof value === 'string' && /^\d+$/.test(value);
  const parsedLimit =
    limit === undefined ? 50 : isNonNegativeInt(limit) ? Number(limit) : Number.NaN;
  const valid =
    hasValidWorkspaceCardPagination(parsedLimit, 0) &&
    ['true', 'false', undefined].includes(archived) &&
    ['true', 'false', undefined].includes(starred) &&
    hasValidWorkspaceCardFilters(status, scheduled) &&
    isValidWorkspaceCardCursor(cursor);
  if (!valid) return null;
  return {
    archived: archived === 'true',
    starred: parseBooleanFilter(starred),
    status: status || null,
    scheduled: parseBooleanFilter(scheduled),
    limit: parsedLimit,
    offset: 0,
    cursor: cursor || null,
  };
}

const runRecency = (run) => run.completedAt ?? run.startedAt ?? 0;

function shouldReplaceWorkspaceCommandRun(current, candidate) {
  const candidateIsRunning = candidate.status === 'running';
  const currentIsRunning = current.status === 'running';
  if (candidateIsRunning !== currentIsRunning) {
    return candidateIsRunning;
  }
  return runRecency(candidate) > runRecency(current);
}

function workspaceCommandRuns(card, runsBySession) {
  const latestByButton = {};
  for (const sessionId of card.memberIds) {
    for (const run of Object.values(runsBySession[sessionId] || {})) {
      const current = latestByButton[run.buttonId];
      if (!current || shouldReplaceWorkspaceCommandRun(current, run)) {
        latestByButton[run.buttonId] = run;
      }
    }
  }
  return Object.values(latestByButton);
}

export function sendWorkspaceCards(res, projectId, query, startedAt) {
  const options = parseWorkspaceCardOptions(query);
  if (!options)
    return res.status(400).json({ error: 'Invalid workspace card pagination or filters' });
  const page = sessions.getWorkspaceCardPage(projectId, options);
  const { cards, facets, total: allTotal } = page;
  const memberIds = [...new Set(cards.flatMap((card) => card.memberIds))];
  const memberIdSet = new Set(memberIds);
  const runsBySession = buildRunsBySession(
    // The list resumes output polling from a card run, so it needs the
    // output-chunk metadata the board broadcast deliberately omits.
    commandRuns.getLatestRunsForSessions(memberIds, { includeOutputMetadata: true }),
    commandRunner
      .getRunningByProjectId(projectId, (sessionIds) => sessions.getByIds(sessionIds))
      .filter((run) => memberIdSet.has(run.sessionId))
  );
  const workspaces = cards.map((card) => {
    const { memberIds: cardMemberIds, ...publicCard } = card;
    return {
      ...publicCard,
      // memberIds lets the client resolve a member session's realtime events
      // (command runs, summaries) to the owning card so they can be patched
      // locally instead of triggering a full list refresh.
      memberIds: cardMemberIds,
      pendingAgentInput: cardMemberIds.some(hasPendingPrompt),
      latestCommandRuns: workspaceCommandRuns(card, runsBySession),
    };
  });
  const total = options.status ? facets[options.status] : allTotal;
  return sendWorkspaceJson(
    res,
    {
      workspaces,
      facets,
      pagination: {
        total,
        limit: options.limit,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
    },
    startedAt
  );
}

export function decorateWorkspaceCard(card, projectId) {
  const memberIdSet = new Set(card.memberIds);
  const runsBySession = buildRunsBySession(
    commandRuns.getLatestRunsForSessions(card.memberIds, { includeOutputMetadata: true }),
    commandRunner
      .getRunningByProjectId(projectId, (ids) => sessions.getByIds(ids))
      .filter((run) => memberIdSet.has(run.sessionId))
  );
  return {
    ...card,
    pendingAgentInput: card.memberIds.some(hasPendingPrompt),
    latestCommandRuns: workspaceCommandRuns(card, runsBySession),
  };
}
