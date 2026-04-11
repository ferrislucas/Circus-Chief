/**
 * Performance Audit Tests
 *
 * These tests measure real-world page load performance against the LIVE server
 * on port 5000 with real data. They do NOT create or modify any data.
 *
 * Run with:
 *   BASE_URL=http://localhost:5000 API_URL=http://localhost:5000 npx playwright test tests/e2e/performance-audit.spec.ts
 *
 * The tests intercept all network requests to build a detailed timing profile
 * showing exactly which API calls are slow and which are waterfall-sequential.
 */

import { test, expect } from '@playwright/test';
import { API_URL } from './helpers';

const LIVE_API = API_URL;

// Thresholds (in ms) — adjust as you tighten performance
const THRESHOLDS = {
  projectListLoad: 3000,
  sessionListLoad: 5000,
  sessionDetailLoad: 10000,
  apiCallSlow: 1000, // Any single API call taking longer than this is flagged
};

// ─── Helpers ───────────────────────────────────────────────────────────

interface APITiming {
  url: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  startedAt: number;
  size: number;
}

/**
 * Attach a network listener that records timings for all /api/ requests.
 * Returns a function that stops recording and returns the collected timings.
 */
function startAPIRecorder(page: import('@playwright/test').Page) {
  const timings: APITiming[] = [];
  const pending = new Map<string, { url: string; method: string; path: string; startedAt: number }>();

  const onRequest = (request: import('@playwright/test').Request) => {
    const url = request.url();
    if (!url.includes('/api/')) return;
    const path = new URL(url).pathname + new URL(url).search;
    pending.set(url + '|' + request.method(), {
      url,
      method: request.method(),
      path,
      startedAt: Date.now(),
    });
  };

  const onResponse = async (response: import('@playwright/test').Response) => {
    const request = response.request();
    const key = request.url() + '|' + request.method();
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);

    let size = 0;
    try {
      const body = await response.body();
      size = body.length;
    } catch {
      // response body may not be available
    }

    timings.push({
      ...entry,
      status: response.status(),
      durationMs: Date.now() - entry.startedAt,
      size,
    });
  };

  page.on('request', onRequest);
  page.on('response', onResponse);

  return {
    stop: () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
      return timings;
    },
    get timings() {
      return timings;
    },
  };
}

function formatTimings(timings: APITiming[], pageLoadMs: number, label: string) {
  const sorted = [...timings].sort((a, b) => a.startedAt - b.startedAt);
  const earliest = sorted.length > 0 ? sorted[0].startedAt : 0;

  const lines: string[] = [
    '',
    `══════════════════════════════════════════════════════════`,
    `  PERFORMANCE REPORT: ${label}`,
    `══════════════════════════════════════════════════════════`,
    `  Total page load time: ${pageLoadMs}ms`,
    `  API calls made: ${timings.length}`,
    `  Total API payload: ${(timings.reduce((s, t) => s + t.size, 0) / 1024).toFixed(1)} KB`,
    `──────────────────────────────────────────────────────────`,
    `  TIMELINE (each call relative to navigation start):`,
    `──────────────────────────────────────────────────────────`,
  ];

  for (const t of sorted) {
    const offset = t.startedAt - earliest;
    const flag = t.durationMs > THRESHOLDS.apiCallSlow ? ' 🐌 SLOW' : '';
    const sizeStr = t.size > 0 ? ` (${(t.size / 1024).toFixed(1)}KB)` : '';
    lines.push(
      `  +${String(offset).padStart(5)}ms  ${t.method.padEnd(4)} ${t.path}`
    );
    lines.push(
      `           → ${t.status} in ${t.durationMs}ms${sizeStr}${flag}`
    );
  }

  // Detect waterfall patterns (calls that start after previous call finishes)
  const waterfalls: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevEnd = prev.startedAt + prev.durationMs;
    // If current started after previous ended (within 50ms tolerance), it's sequential
    if (curr.startedAt >= prevEnd - 50 && curr.startedAt <= prevEnd + 100) {
      waterfalls.push(
        `  ${prev.path} (${prev.durationMs}ms) → ${curr.path} (${curr.durationMs}ms)`
      );
    }
  }

  if (waterfalls.length > 0) {
    lines.push(`──────────────────────────────────────────────────────────`);
    lines.push(`  ⚠️  WATERFALL SEQUENCES (sequential, not parallel):`);
    lines.push(`──────────────────────────────────────────────────────────`);
    waterfalls.forEach((w) => lines.push(w));
  }

  // Flag slow calls
  const slowCalls = timings.filter((t) => t.durationMs > THRESHOLDS.apiCallSlow);
  if (slowCalls.length > 0) {
    lines.push(`──────────────────────────────────────────────────────────`);
    lines.push(`  🐌 SLOW API CALLS (>${THRESHOLDS.apiCallSlow}ms):`);
    lines.push(`──────────────────────────────────────────────────────────`);
    for (const t of slowCalls.sort((a, b) => b.durationMs - a.durationMs)) {
      lines.push(`  ${t.durationMs}ms  ${t.method} ${t.path} (${(t.size / 1024).toFixed(1)}KB)`);
    }
  }

  // Summary of calls by endpoint pattern
  const byEndpoint = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  for (const t of timings) {
    // Normalize UUIDs in paths to :id for grouping
    const normalized = t.path.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ':id'
    );
    const key = `${t.method} ${normalized}`;
    const existing = byEndpoint.get(key) || { count: 0, totalMs: 0, maxMs: 0 };
    existing.count++;
    existing.totalMs += t.durationMs;
    existing.maxMs = Math.max(existing.maxMs, t.durationMs);
    byEndpoint.set(key, existing);
  }

  lines.push(`──────────────────────────────────────────────────────────`);
  lines.push(`  📊 API CALL SUMMARY BY ENDPOINT:`);
  lines.push(`──────────────────────────────────────────────────────────`);
  for (const [endpoint, stats] of [...byEndpoint.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs)) {
    lines.push(
      `  ${endpoint}: ${stats.count}x, total=${stats.totalMs}ms, avg=${Math.round(stats.totalMs / stats.count)}ms, max=${stats.maxMs}ms`
    );
  }

  lines.push(`══════════════════════════════════════════════════════════`);
  return lines.join('\n');
}

// ─── Fetch real project/session IDs from live server ────────────────

async function getFirstProject(): Promise<{ id: string; name: string } | null> {
  const res = await fetch(`${LIVE_API}/api/projects`);
  if (!res.ok) return null;
  const projects = await res.json();
  // Pick the project with the most sessions (most interesting for perf testing)
  if (projects.length === 0) return null;
  return projects[0];
}

async function getProjectWithMostSessions(): Promise<{ id: string; name: string } | null> {
  const res = await fetch(`${LIVE_API}/api/projects`);
  if (!res.ok) return null;
  const projectList = await res.json();
  if (projectList.length === 0) return null;

  let best = projectList[0];
  let bestCount = 0;

  for (const project of projectList) {
    const sessRes = await fetch(`${LIVE_API}/api/projects/${project.id}/sessions`);
    if (sessRes.ok) {
      const sessions = await sessRes.json();
      const count = Array.isArray(sessions) ? sessions.length : (sessions.sessions?.length || 0);
      if (count > bestCount) {
        bestCount = count;
        best = project;
      }
    }
  }

  return best;
}

async function getFirstSessionForProject(projectId: string): Promise<{ id: string; name: string } | null> {
  const res = await fetch(`${LIVE_API}/api/projects/${projectId}/sessions`);
  if (!res.ok) return null;
  const data = await res.json();
  const sessions = Array.isArray(data) ? data : data.sessions || [];
  // Pick a session that likely has messages (completed or running)
  const withContent = sessions.find((s: any) => s.status === 'completed' || s.status === 'waiting' || s.status === 'running');
  return withContent || sessions[0] || null;
}

// ─── Tests ──────────────────────────────────────────────────────────

test.describe('Performance Audit (read-only, live data)', () => {
  // Generous timeout since we're measuring performance, not racing it
  test.describe.configure({ timeout: 120000 });

  test('Project list page load performance', async ({ page }) => {
    const recorder = startAPIRecorder(page);
    const start = Date.now();

    await page.goto('/');
    // Wait for content to actually render
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    // Wait for project cards to appear
    try {
      await page.locator('[class*="project"], [data-testid*="project"], a[href*="/projects/"]').first().waitFor({ timeout: 10000 });
    } catch {
      // OK if no projects - we just measure the load
    }

    const loadTime = Date.now() - start;
    const timings = recorder.stop();
    const report = formatTimings(timings, loadTime, 'Project List');

    console.log(report);

    // Soft assertion — we want to know the number, test still passes
    if (loadTime > THRESHOLDS.projectListLoad) {
      console.warn(`⚠️  Project list load time ${loadTime}ms exceeds threshold ${THRESHOLDS.projectListLoad}ms`);
    }

    // Hard assertion: page should load within a reasonable time
    expect(loadTime).toBeLessThan(THRESHOLDS.projectListLoad * 3); // 3x threshold = hard fail
  });

  test('Session list page load performance', async ({ page }) => {
    const project = await getProjectWithMostSessions();
    test.skip(!project, 'No projects found on live server');

    const recorder = startAPIRecorder(page);
    const start = Date.now();

    await page.goto(`/projects/${project!.id}/sessions`);
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    // Wait for session cards or empty state to appear
    try {
      await page.locator('[class*="session"], [data-testid*="session"], .empty-state, a[href*="/sessions/"]').first().waitFor({ timeout: 15000 });
    } catch {
      // Page loaded but no recognizable elements — that's OK for measurement
    }

    // Wait an extra 3s for any summary fetches that fire after initial render
    await page.waitForTimeout(3000);

    const loadTime = Date.now() - start;
    const timings = recorder.stop();
    const report = formatTimings(timings, loadTime, `Session List (project: ${project!.name})`);

    console.log(report);

    // Count summary calls — each one is a separate request, that's the N+1 problem
    const summaryCalls = timings.filter((t) => t.path.includes('/summary'));
    if (summaryCalls.length > 3) {
      console.warn(
        `⚠️  ${summaryCalls.length} individual summary API calls detected! ` +
        `Total summary fetch time: ${summaryCalls.reduce((s, t) => s + t.durationMs, 0)}ms. ` +
        `Consider a batch summary endpoint.`
      );
    }

    if (loadTime > THRESHOLDS.sessionListLoad) {
      console.warn(`⚠️  Session list load time ${loadTime}ms exceeds threshold ${THRESHOLDS.sessionListLoad}ms`);
    }

    // Soft pass — the real value is the console report above
    expect(loadTime).toBeLessThan(THRESHOLDS.sessionListLoad * 10);
  });

  test('Session detail page load performance', async ({ page }) => {
    const project = await getFirstProject();
    test.skip(!project, 'No projects found on live server');

    const session = await getFirstSessionForProject(project!.id);
    test.skip(!session, 'No sessions found on live server');

    const recorder = startAPIRecorder(page);
    const start = Date.now();

    await page.goto(`/sessions/${session!.id}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    // Wait for message content or conversation to appear
    try {
      await page.locator('.message-content, .conversation-tab, [class*="message"], [data-testid*="message"]').first().waitFor({ timeout: 15000 });
    } catch {
      // OK — some sessions may be empty
    }

    const loadTime = Date.now() - start;
    const timings = recorder.stop();
    const report = formatTimings(timings, loadTime, `Session Detail (${session!.name || session!.id})`);

    console.log(report);

    if (loadTime > THRESHOLDS.sessionDetailLoad) {
      console.warn(`⚠️  Session detail load time ${loadTime}ms exceeds threshold ${THRESHOLDS.sessionDetailLoad}ms`);
    }

    expect(loadTime).toBeLessThan(THRESHOLDS.sessionDetailLoad * 3);
  });

  test('API endpoint direct timing (no browser overhead)', async () => {
    const project = await getProjectWithMostSessions();
    test.skip(!project, 'No projects found on live server');

    const results: { endpoint: string; durationMs: number; size: number; note?: string }[] = [];

    // 1. GET /api/projects
    {
      const start = Date.now();
      const res = await fetch(`${LIVE_API}/api/projects`);
      const body = await res.text();
      results.push({
        endpoint: 'GET /api/projects',
        durationMs: Date.now() - start,
        size: body.length,
      });
    }

    // 2. GET /api/projects/:id/sessions (non-archived)
    {
      const start = Date.now();
      const res = await fetch(`${LIVE_API}/api/projects/${project!.id}/sessions`);
      const body = await res.text();
      const data = JSON.parse(body);
      const count = Array.isArray(data) ? data.length : data.sessions?.length || 0;
      results.push({
        endpoint: `GET /api/projects/:id/sessions`,
        durationMs: Date.now() - start,
        size: body.length,
        note: `${count} sessions returned`,
      });
    }

    // 3. GET /api/projects/:id/sessions?archived=true (with pagination)
    {
      const start = Date.now();
      const res = await fetch(`${LIVE_API}/api/projects/${project!.id}/sessions?archived=true&limit=25&offset=0`);
      const body = await res.text();
      results.push({
        endpoint: `GET /api/projects/:id/sessions?archived=true`,
        durationMs: Date.now() - start,
        size: body.length,
      });
    }

    // 4. Get a session with messages and test message endpoint
    const sessions = await (await fetch(`${LIVE_API}/api/projects/${project!.id}/sessions`)).json();
    const sessionList = Array.isArray(sessions) ? sessions : sessions.sessions || [];
    const testSession = sessionList.find((s: any) => s.status === 'completed' || s.status === 'waiting') || sessionList[0];

    if (testSession) {
      // 4a. GET /api/sessions/:id
      {
        const start = Date.now();
        const res = await fetch(`${LIVE_API}/api/sessions/${testSession.id}`);
        const body = await res.text();
        results.push({
          endpoint: 'GET /api/sessions/:id',
          durationMs: Date.now() - start,
          size: body.length,
        });
      }

      // 4b. GET /api/sessions/:id/messages
      {
        const start = Date.now();
        const res = await fetch(`${LIVE_API}/api/sessions/${testSession.id}/messages`);
        const body = await res.text();
        const msgs = JSON.parse(body);
        results.push({
          endpoint: 'GET /api/sessions/:id/messages',
          durationMs: Date.now() - start,
          size: body.length,
          note: `${msgs.length} messages, watch for N+1 attachment queries`,
        });
      }

      // 4c. GET /api/sessions/:id/summary
      {
        const start = Date.now();
        const res = await fetch(`${LIVE_API}/api/sessions/${testSession.id}/summary`);
        const body = await res.text();
        results.push({
          endpoint: 'GET /api/sessions/:id/summary',
          durationMs: Date.now() - start,
          size: body.length,
        });
      }

      // 4d. GET /api/sessions/:id/conversations
      {
        const start = Date.now();
        const res = await fetch(`${LIVE_API}/api/sessions/${testSession.id}/conversations`);
        const body = await res.text();
        results.push({
          endpoint: 'GET /api/sessions/:id/conversations',
          durationMs: Date.now() - start,
          size: body.length,
        });
      }

      // 4e. GET /api/sessions/:id/work-logs
      {
        const start = Date.now();
        const res = await fetch(`${LIVE_API}/api/sessions/${testSession.id}/work-logs`);
        const body = await res.text();
        results.push({
          endpoint: 'GET /api/sessions/:id/work-logs',
          durationMs: Date.now() - start,
          size: body.length,
        });
      }

      // 4f. GET /api/sessions/:id/canvas
      {
        const start = Date.now();
        const res = await fetch(`${LIVE_API}/api/sessions/${testSession.id}/canvas`);
        const body = await res.text();
        results.push({
          endpoint: 'GET /api/sessions/:id/canvas',
          durationMs: Date.now() - start,
          size: body.length,
        });
      }

      // 4g. GET /api/sessions/:id/todos
      {
        const start = Date.now();
        const res = await fetch(`${LIVE_API}/api/sessions/${testSession.id}/todos`);
        const body = await res.text();
        results.push({
          endpoint: 'GET /api/sessions/:id/todos',
          durationMs: Date.now() - start,
          size: body.length,
        });
      }

      // 5. Simulate the N+1 summary fetch pattern (fetch summaries for first 10 sessions)
      const summaryTargets = sessionList.slice(0, 10);
      {
        const start = Date.now();
        const summaryResults = await Promise.all(
          summaryTargets.map(async (s: any) => {
            const sStart = Date.now();
            const res = await fetch(`${LIVE_API}/api/sessions/${s.id}/summary`);
            await res.text();
            return { id: s.id, durationMs: Date.now() - sStart };
          })
        );
        const totalMs = Date.now() - start;
        const maxMs = Math.max(...summaryResults.map((r) => r.durationMs));
        const avgMs = Math.round(summaryResults.reduce((s, r) => s + r.durationMs, 0) / summaryResults.length);
        results.push({
          endpoint: `GET /api/sessions/:id/summary (×${summaryTargets.length} parallel)`,
          durationMs: totalMs,
          size: 0,
          note: `wall=${totalMs}ms, avg=${avgMs}ms, max=${maxMs}ms per call`,
        });
      }

      // 6. Simulate sequential summary fetches (what the UI actually does)
      {
        const seqTargets = sessionList.slice(0, 10);
        const start = Date.now();
        for (const s of seqTargets) {
          const res = await fetch(`${LIVE_API}/api/sessions/${s.id}/summary`);
          await res.text();
        }
        const totalMs = Date.now() - start;
        results.push({
          endpoint: `GET /api/sessions/:id/summary (×${seqTargets.length} SEQUENTIAL)`,
          durationMs: totalMs,
          size: 0,
          note: `⚠️ This is what the UI does — sequential, not batched!`,
        });
      }
    }

    // Print report
    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log('  RAW API ENDPOINT PERFORMANCE');
    console.log('══════════════════════════════════════════════════════════');
    for (const r of results) {
      const flag = r.durationMs > THRESHOLDS.apiCallSlow ? ' 🐌 SLOW' : '';
      const sizeStr = r.size > 0 ? ` (${(r.size / 1024).toFixed(1)}KB)` : '';
      console.log(`  ${String(r.durationMs).padStart(5)}ms  ${r.endpoint}${sizeStr}${flag}`);
      if (r.note) console.log(`           ${r.note}`);
    }
    console.log('══════════════════════════════════════════════════════════');

    // Assert no single critical endpoint is catastrophically slow
    const critical = results.filter(
      (r) =>
        r.endpoint.includes('/sessions') &&
        !r.endpoint.includes('SEQUENTIAL') &&
        !r.endpoint.includes('parallel')
    );
    for (const r of critical) {
      expect(
        r.durationMs,
        `${r.endpoint} took ${r.durationMs}ms (threshold: ${THRESHOLDS.apiCallSlow * 5}ms)`
      ).toBeLessThan(THRESHOLDS.apiCallSlow * 5);
    }
  });

  test('Session list measures time-to-interactive (all sessions rendered)', async ({ page }) => {
    const project = await getProjectWithMostSessions();
    test.skip(!project, 'No projects found on live server');

    const start = Date.now();
    await page.goto(`/projects/${project!.id}/sessions`);

    // Wait for first session card to be visible
    let firstCardTime = 0;
    try {
      await page.locator('a[href*="/sessions/"]').first().waitFor({ state: 'visible', timeout: 15000 });
      firstCardTime = Date.now() - start;
    } catch {
      firstCardTime = -1; // no cards found
    }

    // Wait for all network activity to finish (summaries, etc.)
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    const networkIdleTime = Date.now() - start;

    // Count how many session links are rendered
    const sessionCount = await page.locator('a[href*="/sessions/"]').count();

    // Check if summaries are still loading (look for loading indicators)
    const loadingIndicators = await page.locator('.animate-pulse, [class*="loading"], [class*="skeleton"]').count();

    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log('  TIME-TO-INTERACTIVE: Session List');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  First session card visible: ${firstCardTime}ms`);
    console.log(`  Network idle: ${networkIdleTime}ms`);
    console.log(`  Sessions rendered: ${sessionCount}`);
    console.log(`  Loading indicators still visible: ${loadingIndicators}`);
    console.log('══════════════════════════════════════════════════════════');

    if (firstCardTime > 0) {
      expect(firstCardTime).toBeLessThan(THRESHOLDS.sessionListLoad);
    }
  });
});
