import { Page, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';

export function getAPIURL(): string {
  if (process.env.API_URL) return process.env.API_URL;

  // Look for .server-port file in the project root (relative to cwd)
  const portFile = join(process.cwd(), '.server-port');
  if (existsSync(portFile)) {
    const port = readFileSync(portFile, 'utf-8').trim();
    return `http://localhost:${port}`;
  }

  return 'http://localhost:5000';
}

const API_URL = getAPIURL();

// Generate unique test prefix per test run to avoid race conditions between parallel tests
const TEST_RUN_ID = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
const TEST_PREFIX = `[TEST-${TEST_RUN_ID}] `;

// ============================================================
// Resource Tracking for Scoped Cleanup
// ============================================================

// Track created resources for scoped cleanup per test
const createdResources = {
  projects: new Set<string>(),
  sessions: new Set<string>(),
  providers: new Set<string>(),
};

/**
 * Clear the resource tracking (called after cleanup)
 */
function clearResourceTracking() {
  createdResources.projects.clear();
  createdResources.sessions.clear();
  createdResources.providers.clear();
}

/**
 * Clean up only resources created by the current test
 */
export async function cleanupCreatedResources() {
  // Delete sessions first (they depend on projects)
  for (const sessionId of createdResources.sessions) {
    try {
      await fetch(`${API_URL}/api/sessions/${sessionId}`, { method: 'DELETE' });
    } catch (e) {
      // Ignore errors - session may already be deleted
    }
  }

  // Then delete projects
  for (const projectId of createdResources.projects) {
    try {
      await fetch(`${API_URL}/api/projects/${projectId}`, { method: 'DELETE' });
    } catch (e) {
      // Ignore errors - project may already be deleted
    }
  }

  // Then delete providers tracked by this test
  for (const providerId of createdResources.providers) {
    try {
      await fetch(`${API_URL}/api/providers/${providerId}`, { method: 'DELETE' });
    } catch (e) {
      // Ignore errors - provider may already be deleted
    }
  }

  clearResourceTracking();
}

// ============================================================
// Wait/Navigation Helpers for DOM Readiness
// ============================================================

/**
 * Wait for page to be fully loaded and ready
 */
export async function waitForPageReady(page: Page, options: { timeout?: number } = {}) {
  const timeout = options.timeout || 10000;
  await page.waitForLoadState('networkidle', { timeout });
  // Wait for any loading indicators to disappear
  const loadingIndicators = page.locator('.loading, .spinner, [data-loading="true"]');
  const count = await loadingIndicators.count();
  if (count > 0) {
    await expect(loadingIndicators.first()).not.toBeVisible({ timeout });
  }
}

/**
 * Navigate to a URL and wait for page to be ready
 */
export async function navigateAndWait(page: Page, url: string, options: { timeout?: number } = {}) {
  await page.goto(url);
  await waitForPageReady(page, options);
}

/**
 * Wait for a session to exist in the API
 */
export async function waitForSessionToExist(sessionId: string, timeout = 5000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const session = await getSession(sessionId);
    if (session) return session;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Session ${sessionId} not found after ${timeout}ms`);
}

/**
 * Wait for a project to have a certain number of sessions
 */
export async function waitForProjectSessions(
  projectId: string,
  minCount: number,
  timeout = 5000
): Promise<any[]> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const sessions = await getProjectSessions(projectId);
    if (sessions.length >= minCount) return sessions;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Expected at least ${minCount} sessions, found less after ${timeout}ms`);
}

/**
 * Wait for canvas items to exist
 */
export async function waitForCanvasItems(
  sessionId: string,
  minCount: number,
  timeout = 5000
): Promise<any[]> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const items = await getCanvasItems(sessionId);
    if (items.length >= minCount) return items;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Expected at least ${minCount} canvas items, found less after ${timeout}ms`);
}

/**
 * Wait for an element to be visible with extended timeout
 */
export async function waitForElement(
  page: Page,
  selector: string,
  options: { timeout?: number; state?: 'visible' | 'attached' | 'hidden' } = {}
) {
  const element = page.locator(selector);
  await element.waitFor({
    state: options.state || 'visible',
    timeout: options.timeout || 10000,
  });
  return element;
}

/**
 * Wait for text to be visible on the page
 */
export async function waitForTextVisible(page: Page, text: string, timeout = 10000) {
  await expect(page.getByText(text)).toBeVisible({ timeout });
}

/**
 * Wait for a file to exist (polling with timeout)
 * Used for waiting on hook marker files
 */
export async function waitForFile(filePath: string, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(filePath)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * Read file contents
 * Used for reading hook marker files
 */
export async function readMarkerFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}

// ============================================================
// API Verification Helpers
// ============================================================

export async function getProject(id: string) {
  const response = await fetch(`${API_URL}/api/projects/${id}`);
  if (!response.ok) return null;
  return response.json();
}

export async function getProjects() {
  const response = await fetch(`${API_URL}/api/projects`);
  if (!response.ok) return [];
  return response.json();
}

export async function getSession(id: string) {
  const response = await fetch(`${API_URL}/api/sessions/${id}`);
  if (!response.ok) return null;
  return response.json();
}

export async function getProjectSessions(projectId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions`);
  if (!response.ok) return [];
  return response.json();
}

export async function getCanvasItems(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/canvas`);
  if (!response.ok) return [];
  return response.json();
}

export async function getCanvasTrash(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/canvas-trash`);
  if (!response.ok) return [];
  return response.json();
}

export async function deleteCanvasItem(sessionId: string, itemId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/canvas/${itemId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete canvas item');
  return response.json();
}

export async function recoverCanvasItem(sessionId: string, itemId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/canvas/${itemId}/recover`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to recover canvas item');
  return response.json();
}

export async function recoverCanvasFile(sessionId: string, filename: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/canvas-trash/recover-file/${encodeURIComponent(filename)}`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to recover canvas file');
  return response.json();
}

export async function permanentlyDeleteCanvasItem(sessionId: string, itemId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/canvas/${itemId}/permanent`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to permanently delete canvas item');
}

// ============================================================
// Seeding Helpers
// ============================================================

export async function seedProject(
  name: string,
  workingDirectory: string,
  options?: {
    onSessionCreated?: string;
    onSessionDeleted?: string;
  }
) {
  const testName = `${TEST_PREFIX}${name}`;
  const body: any = { name: testName, workingDirectory };

  // Add hooks if provided
  if (options?.onSessionCreated) {
    body.onSessionCreated = options.onSessionCreated;
  }
  if (options?.onSessionDeleted) {
    body.onSessionDeleted = options.onSessionDeleted;
  }

  const response = await fetch(`${API_URL}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Failed to seed project');
  const project = await response.json();
  // Track for scoped cleanup
  createdResources.projects.add(project.id);
  return project;
}

export async function seedSession(
  projectId: string,
  data: { prompt: string; name?: string; mode?: string; startImmediately?: boolean }
) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to seed session');
  const session = await response.json();
  // Track for scoped cleanup
  createdResources.sessions.add(session.id);
  return session;
}

export async function seedCanvasItem(
  sessionId: string,
  data: { type: string; content?: string; data?: string; mimeType?: string; label?: string; filePath?: string; filename?: string }
) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/canvas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to seed canvas item');
  return response.json();
}

export async function cleanupAll() {
  const projectsResponse = await fetch(`${API_URL}/api/projects`);
  if (!projectsResponse.ok) return;

  const projects = await projectsResponse.json();
  for (const project of projects) {
    // Only delete test projects (prefixed with [TEST])
    if (project.name.startsWith(TEST_PREFIX)) {
      await fetch(`${API_URL}/api/projects/${project.id}`, { method: 'DELETE' });
    }
  }

  // Delete all non-built-in providers whose names start with [TEST.
  // This is safe here because cleanupAll() is only called from global-setup and
  // global-teardown, which run sequentially (not in parallel with any workers).
  const providersResponse = await fetch(`${API_URL}/api/providers`);
  if (!providersResponse.ok) return;

  const providers = await providersResponse.json();
  for (const provider of providers) {
    if (provider.name.startsWith('[TEST') && !provider.isBuiltIn) {
      await fetch(`${API_URL}/api/providers/${provider.id}`, { method: 'DELETE' });
    }
  }
}

export async function waitForWebSocketMessage(
  page: Page,
  messageType: string,
  timeout = 10000
): Promise<any> {
  return page.evaluate(
    ({ messageType, timeout }) => {
      return new Promise((resolve, reject) => {
        const ws = (window as any).__testWebSocket;
        if (!ws) {
          reject(new Error('WebSocket not available'));
          return;
        }

        const timeoutId = setTimeout(() => {
          reject(new Error(`Timeout waiting for ${messageType}`));
        }, timeout);

        const handler = (event: MessageEvent) => {
          const data = JSON.parse(event.data);
          if (data.type === messageType) {
            clearTimeout(timeoutId);
            ws.removeEventListener('message', handler);
            resolve(data);
          }
        };

        ws.addEventListener('message', handler);
      });
    },
    { messageType, timeout }
  );
}

export async function waitForSessionStatus(
  page: Page,
  sessionId: string,
  status: string,
  timeout = 10000
) {
  // Poll the API to check session status instead of looking for DOM element
  // (status badge is not always visible in all views)
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const session = await getSession(sessionId);
    if (session && session.status === status) {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Session ${sessionId} did not reach status "${status}" after ${timeout}ms`);
}

export async function getSessionMessages(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/messages`);
  if (!response.ok) return [];
  return response.json();
}

export async function sendSessionMessage(sessionId: string, content: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send message');
  }
  return response.json();
}

export async function getSessionWorkLogs(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/work-logs`);
  if (!response.ok) return {};
  return response.json();
}

export async function seedWorkLog(
  sessionId: string,
  data: { type: string; content: string; toolName?: string; messageId?: string }
) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/work-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to seed work log');
  return response.json();
}

export async function updateSessionStatus(sessionId: string, status: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error('Failed to update session status');
  return response.json();
}

export async function updateSessionMode(sessionId: string, mode: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) throw new Error('Failed to update session mode');
  return response.json();
}

// ============================================================
// Template Helpers
// ============================================================

export async function seedProjectTemplate(
  projectId: string,
  data: { name: string; prompt: string; nextTemplateId?: string; thinkingEnabled?: boolean; gitBranch?: string }
) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to seed project template');
  return response.json();
}

export async function seedGlobalTemplate(data: {
  name: string;
  prompt: string;
  nextTemplateId?: string;
  thinkingEnabled?: boolean;
  gitBranch?: string;
}) {
  const response = await fetch(`${API_URL}/api/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to seed global template');
  return response.json();
}

export async function getTemplate(id: string) {
  const response = await fetch(`${API_URL}/api/templates/${id}`);
  if (!response.ok) return null;
  return response.json();
}

export async function getProjectTemplates(projectId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/templates`);
  if (!response.ok) return [];
  return response.json();
}

export async function getGlobalTemplates() {
  const response = await fetch(`${API_URL}/api/templates`);
  if (!response.ok) return [];
  return response.json();
}

export async function deleteTemplate(id: string) {
  const response = await fetch(`${API_URL}/api/templates/${id}`, { method: 'DELETE' });
  return response.ok;
}

export async function cleanupTemplates() {
  // Clean up global templates
  const globalTemplates = await getGlobalTemplates();
  for (const template of globalTemplates) {
    if (template.name.startsWith(TEST_PREFIX)) {
      await deleteTemplate(template.id);
    }
  }
}

// ============================================================
// Project Session Defaults Helpers
// ============================================================

export async function getProjectSessionDefaults(projectId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/session-defaults`);
  if (!response.ok) return null;
  return response.json();
}

export async function setProjectSessionDefaults(
  projectId: string,
  defaults: {
    mode?: string;
    thinkingEnabled?: boolean;
    startImmediately?: boolean;
    gitMode?: string | null;
    gitBranch?: string | null;
    model?: string | null;
  }
) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/session-defaults`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(defaults),
  });
  if (!response.ok) throw new Error('Failed to set project session defaults');
  return response.json();
}

export async function resetProjectSessionDefaults(projectId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/session-defaults`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('Failed to reset project session defaults');
  return response.json();
}

// ============================================================
// File Attachment Helpers
// ============================================================

/**
 * Seed a session with file attachments using FormData
 */
export async function seedSessionWithFiles(
  projectId: string,
  data: { prompt: string; name?: string; mode?: string },
  files: Array<{ name: string; content: string; type: string }>
) {
  const formData = new FormData();
  formData.append('prompt', data.prompt);
  if (data.name) formData.append('name', data.name);
  if (data.mode) formData.append('mode', data.mode);

  // Add files to FormData
  for (const file of files) {
    const blob = new Blob([file.content], { type: file.type });
    formData.append('files', blob, file.name);
  }

  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error('Failed to seed session with files');
  const session = await response.json();
  // Track for scoped cleanup
  createdResources.sessions.add(session.id);
  return session;
}

/**
 * Send a message with file attachments
 */
export async function sendMessageWithFiles(
  sessionId: string,
  content: string,
  files: Array<{ name: string; content: string; type: string }>
) {
  const formData = new FormData();
  formData.append('content', content);

  // Add files to FormData
  for (const file of files) {
    const blob = new Blob([file.content], { type: file.type });
    formData.append('files', blob, file.name);
  }

  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/message`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send message with files');
  }
  return response.json();
}

/**
 * Get attachments for a session
 */
export async function getSessionAttachments(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/messages`);
  if (!response.ok) return [];
  const messages = await response.json();
  // Collect all attachments from all messages
  const allAttachments: any[] = [];
  for (const msg of messages) {
    if (msg.attachments && msg.attachments.length > 0) {
      allAttachments.push(...msg.attachments);
    }
  }
  return allAttachments;
}

// ============================================================
// Command Button Helpers
// ============================================================

export async function seedCommandButton(
  projectId: string,
  data: { label: string; command: string; sortOrder?: number; showOnList?: boolean }
) {
  const url = `${API_URL}/api/projects/${projectId}/command-buttons`;
  console.log(`[seedCommandButton] POST ${url}`);
  console.log(`[seedCommandButton] projectId: ${projectId}`);
  console.log(`[seedCommandButton] data: ${JSON.stringify(data)}`);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  console.log(`[seedCommandButton] response.ok: ${response.ok}, status: ${response.status}`);
  if (!response.ok) {
    const errorText = await response.text();
    console.log(`[seedCommandButton] error response: ${errorText}`);
    throw new Error(`Failed to seed command button: ${response.status} ${response.statusText} - ${errorText}`);
  }
  const result = await response.json();
  console.log(`[seedCommandButton] created button: ${JSON.stringify(result)}`);
  return result;
}

/**
 * Run a command button and return the run ID
 */
export async function runCommandButton(sessionId: string, buttonId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/command-buttons/${buttonId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to run command button: ${response.status} - ${errorText}`);
  }
  return response.json();
}

/**
 * Get a specific command run by ID
 */
export async function getCommandRun(sessionId: string, runId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/command-buttons/runs/${runId}`);
  if (!response.ok) return null;
  return response.json();
}

/**
 * Get all command runs for a session
 */
export async function getCommandRuns(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/command-buttons/runs`);
  if (!response.ok) return [];
  return response.json();
}

/**
 * Wait for a command run to complete (not 'running' status)
 * Returns the completed run with output and exit code
 */
export async function waitForCommandRunComplete(
  sessionId: string,
  runId: string,
  timeout = 30000
): Promise<{
  runId: string;
  buttonId: string;
  status: 'success' | 'error' | 'killed';
  output: string;
  exitCode: number;
  startedAt: number;
  completedAt?: number;
}> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const run = await getCommandRun(sessionId, runId);
    if (run && run.status !== 'running') {
      return run;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Command run ${runId} did not complete after ${timeout}ms`);
}

/**
 * Run a command button and wait for completion
 * Convenience function that combines runCommandButton + waitForCommandRunComplete
 */
export async function runCommandButtonAndWait(
  sessionId: string,
  buttonId: string,
  timeout = 30000
) {
  const { runId } = await runCommandButton(sessionId, buttonId);
  return waitForCommandRunComplete(sessionId, runId, timeout);
}

// ============================================================
// Model Provider Helpers
// ============================================================

/**
 * Create a model provider
 */
export async function createProvider(data: {
  name: string;
  baseUrl: string;
  authToken: string;
  defaultSonnetModel?: string;
  defaultOpusModel?: string;
  defaultHaikuModel?: string;
  apiTimeoutMs?: number;
}) {
  const response = await fetch(`${API_URL}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to create provider');
  const provider = await response.json();
  // Track for scoped cleanup
  createdResources.providers.add(provider.id);
  return provider;
}

/**
 * Get all providers
 */
export async function getProviders() {
  const response = await fetch(`${API_URL}/api/providers`);
  if (!response.ok) return [];
  return response.json();
}

/**
 * Get a specific provider by ID
 */
export async function getProvider(id: string) {
  const response = await fetch(`${API_URL}/api/providers/${id}`);
  if (!response.ok) return null;
  return response.json();
}

/**
 * Update a provider
 */
export async function updateProvider(id: string, data: {
  name?: string;
  baseUrl?: string;
  authToken?: string;
  defaultSonnetModel?: string;
  defaultOpusModel?: string;
  defaultHaikuModel?: string;
  apiTimeoutMs?: number;
}) {
  const response = await fetch(`${API_URL}/api/providers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update provider');
  return response.json();
}

/**
 * Delete a provider
 */
export async function deleteProvider(id: string) {
  const response = await fetch(`${API_URL}/api/providers/${id}`, {
    method: 'DELETE',
  });
  return response.ok;
}

/**
 * Test provider connection
 */
export async function testProviderConnection(id: string) {
  const response = await fetch(`${API_URL}/api/providers/${id}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('Failed to test provider connection');
  return response.json();
}

/**
 * Cleanup test providers created by this worker (those with TEST_PREFIX).
 * Uses the per-worker TEST_PREFIX so parallel workers cannot accidentally
 * delete each other's providers. For a broader sweep of all [TEST]-prefixed
 * providers, use cleanupAll() (global setup/teardown only).
 */
export async function cleanupProviders() {
  const providers = await getProviders();
  for (const provider of providers) {
    // Only delete custom providers (those with TEST_PREFIX) and not built-in ones
    if (provider.name.startsWith(TEST_PREFIX) && !provider.isBuiltIn) {
      await deleteProvider(provider.id);
    }
  }
}

// ============================================================
// Session PR Data Helpers
// ============================================================

/**
 * Update session with PR data
 */
export async function updateSessionWithPR(sessionId: string, prData: {
  prUrl?: string;
  prState?: 'open' | 'merged' | 'closed' | 'draft';
  hasMergeConflicts?: boolean;
  ciStatus?: 'success' | 'failure' | 'pending';
}) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prData),
  });
  if (!response.ok) throw new Error('Failed to update session PR data');
  return response.json();
}

/**
 * Get session summary
 */
export async function getSessionSummary(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/summary`);
  if (!response.ok) return null;
  return response.json();
}

/**
 * Set session summary (for testing PR indicators that depend on summary data)
 */
export async function setSessionSummary(sessionId: string, summaryData: {
  shortSummary?: string;
  longSummary?: string;
  prNumber?: string;
  prState?: string;
  hasMergeConflicts?: boolean;
  ciStatus?: string;
}) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summaryData),
  });
  if (!response.ok) throw new Error('Failed to set session summary');
  return response.json();
}

// ============================================================
// Child Session Helpers
// ============================================================

/**
 * Create a child session (session with a parent)
 */
export async function seedChildSession(
  projectId: string,
  parentSessionId: string,
  data: { prompt: string; name?: string; mode?: string }
) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...data,
      parentSessionId,
      startImmediately: false,
    }),
  });
  if (!response.ok) throw new Error('Failed to seed child session');
  const session = await response.json();
  // Track for scoped cleanup
  createdResources.sessions.add(session.id);
  return session;
}

/**
 * Get child sessions for a parent session
 */
export async function getChildSessions(parentSessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${parentSessionId}/children`);
  if (!response.ok) return [];
  return response.json();
}

// ============================================================
// Session Action Helpers (Star, Archive, Duplicate, Delete, etc.)
// ============================================================

/**
 * Toggle session star status
 */
export async function toggleSessionStar(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/star`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('Failed to toggle session star');
  return response.json();
}

/**
 * Archive a session
 */
export async function archiveSession(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('Failed to archive session');
  return response.json();
}

/**
 * Unarchive a session
 */
export async function unarchiveSession(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/unarchive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('Failed to unarchive session');
  return response.json();
}

/**
 * Duplicate a session
 */
export async function duplicateSession(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('Failed to duplicate session');
  return response.json();
}

/**
 * Delete a session
 */
export async function deleteSession(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete session');
  // DELETE returns 204 No Content
  if (response.status === 204) return null;
  return response.json();
}

/**
 * Track an externally created session for cleanup
 * (e.g., sessions created via UI or duplication that need to be cleaned up)
 */
export function trackSession(sessionId: string) {
  createdResources.sessions.add(sessionId);
}

/**
 * Stop a session
 */
export async function stopSession(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('Failed to stop session');
  return response.json();
}

/**
 * Restart a session
 */
export async function restartSession(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('Failed to restart session');
  return response.json();
}

/**
 * Get all active sessions (across all projects)
 */
export async function getActiveSessions() {
  const response = await fetch(`${API_URL}/api/sessions`);
  if (!response.ok) return [];
  return response.json();
}

/**
 * Get archived sessions for a project
 */
export async function getArchivedSessions(projectId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions?archived=true`);
  if (!response.ok) return [];
  return response.json();
}

// ============================================================
// Session Note Helpers
// ============================================================

/**
 * Create a session note
 */
export async function seedSessionNote(sessionId: string, data: { content: string }) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to seed session note');
  return response.json();
}

/**
 * Get notes for a session
 */
export async function getSessionNotes(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/notes`);
  if (!response.ok) return [];
  return response.json();
}
