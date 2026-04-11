/**
 * Integration test setup.
 *
 * Starts a real HTTP server with WebSocket support on a random port
 * before each test suite, and tears it down after.
 *
 * Exports helper functions for API requests, seeding data, and server lifecycle.
 */
import { beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { createApp } from '../../packages/server/src/app.js';
import { initDatabase, closeDatabase } from '../../packages/server/src/database.js';
import { initWebSocket } from '../../packages/server/src/websocket.js';

// Suppress logs during tests
process.env.NODE_ENV = 'test';
console.log = () => {};

let server = null;

/**
 * @type {string} Base URL for HTTP requests (e.g. http://localhost:50123)
 */
let _baseUrl = '';

/**
 * Get the base URL for the integration test server.
 * Returns the current base URL string.
 */
export function getBaseUrl() {
  return _baseUrl;
}

// ============================================================
// HTTP API Helpers
// ============================================================

/**
 * Make an API request against the integration test server.
 */
export async function apiFetch(path, options = {}) {
  const url = `${_baseUrl}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return response;
}

/**
 * Make an API GET request and return parsed JSON (or null on error).
 */
export async function apiGet(path) {
  const response = await apiFetch(path);
  if (!response.ok) return null;
  return response.json();
}

/**
 * Make an API POST request and return parsed JSON.
 */
export async function apiPost(path, body) {
  const response = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API POST ${path} failed (${response.status}): ${text}`);
  }
  return response.json();
}

/**
 * Make an API PATCH request and return parsed JSON.
 */
export async function apiPatch(path, body) {
  const response = await apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API PATCH ${path} failed (${response.status}): ${text}`);
  }
  return response.json();
}

/**
 * Make an API DELETE request.
 */
export async function apiDelete(path) {
  const response = await apiFetch(path, { method: 'DELETE' });
  return response;
}

// ============================================================
// Data Seeding Helpers
// ============================================================

/**
 * Seed a project via the API.
 */
export async function seedProject(name = 'Test Project', workingDirectory = '/tmp/test') {
  return apiPost('/api/projects', { name, workingDirectory });
}

/**
 * Seed a session via the API.
 */
export async function seedSession(projectId, options = {}) {
  return apiPost(`/api/projects/${projectId}/sessions`, {
    prompt: options.prompt || 'Test prompt',
    name: options.name || 'Test Session',
    startImmediately: options.startImmediately ?? false,
    ...options,
  });
}

/**
 * Get a session via the API.
 */
export async function getSession(sessionId) {
  return apiGet(`/api/sessions/${sessionId}`);
}

/**
 * Get project sessions via the API.
 */
export async function getProjectSessions(projectId) {
  return apiGet(`/api/projects/${projectId}/sessions`);
}

/**
 * Update session status.
 */
export async function updateSessionStatus(sessionId, status) {
  return apiPatch(`/api/sessions/${sessionId}`, { status });
}

/**
 * Get session messages via the API.
 */
export async function getSessionMessages(sessionId) {
  return apiGet(`/api/sessions/${sessionId}/messages`);
}

/**
 * Send a message to a session via the API.
 */
export async function sendSessionMessage(sessionId, content) {
  return apiPost(`/api/sessions/${sessionId}/messages`, { content });
}

/**
 * Seed a canvas item.
 */
export async function seedCanvasItem(sessionId, item) {
  return apiPost(`/api/sessions/${sessionId}/canvas`, item);
}

/**
 * Get canvas items for a session.
 */
export async function getCanvasItems(sessionId) {
  return apiGet(`/api/sessions/${sessionId}/canvas`);
}

/**
 * Seed a session note.
 */
export async function seedSessionNote(sessionId, note) {
  return apiPost(`/api/sessions/${sessionId}/notes`, note);
}

/**
 * Get session notes.
 */
export async function getSessionNotes(sessionId) {
  return apiGet(`/api/sessions/${sessionId}/notes`);
}

/**
 * Duplicate a session via the API.
 */
export async function duplicateSession(sessionId) {
  return apiPost(`/api/sessions/${sessionId}/duplicate`, {});
}

/**
 * Stop a session via the API.
 */
export async function stopSession(sessionId) {
  const response = await apiFetch(`/api/sessions/${sessionId}/stop`, { method: 'POST' });
  if (!response.ok) throw new Error(`Failed to stop session: ${response.status}`);
  return response.json();
}

/**
 * Wait for a session to reach a specific status.
 */
export async function waitForSessionStatus(sessionId, status, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const session = await getSession(sessionId);
    if (session?.status === status) return session;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Session ${sessionId} did not reach status "${status}" within ${timeout}ms`);
}

// ============================================================
// Server Lifecycle
// ============================================================

/**
 * Start the integration test server. Called once per test file.
 */
export async function startServer() {
  // Initialize in-memory database
  initDatabase(':memory:');

  // Create Express app and HTTP server
  const app = createApp();
  server = createServer(app);

  // Initialize WebSocket support
  initWebSocket(server);

  // Listen on a random available port
  await new Promise((resolve) => {
    server.listen(0, () => resolve());
  });

  const addr = server.address();
  _baseUrl = `http://127.0.0.1:${addr.port}`;
}

/**
 * Stop the integration test server.
 */
export async function stopServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  closeDatabase();
}

// Auto-start/stop for vitest global setup
beforeAll(async () => {
  await startServer();
}, 15000);

afterAll(async () => {
  await stopServer();
}, 15000);
