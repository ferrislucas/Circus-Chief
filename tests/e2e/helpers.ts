import { Page } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';

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

export const API_URL = getAPIURL();

// BASE_URL is used for frontend navigation (defaults to same as API_URL)
export const BASE_URL = process.env.BASE_URL || API_URL;

// Generate unique test prefix per test run to avoid race conditions between parallel tests
const TEST_RUN_ID = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
export const TEST_PREFIX = `[TEST-${TEST_RUN_ID}] `;

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
    await loadingIndicators.first().waitFor({ state: 'hidden', timeout });
  }
}

/**
 * Navigate to a URL and wait for page to be ready.
 *
 * Options:
 *  - timeout: overall timeout for navigation + readiness (default 10000ms)
 *  - waitFor: a CSS selector to wait for after networkidle (resolves race
 *    conditions where async Vue data-fetching completes after the initial
 *    load event). The selector is awaited with { state: 'visible' }.
 */
export async function navigateAndWait(
  page: Page,
  url: string,
  options: { timeout?: number; waitFor?: string } = {},
) {
  await page.goto(url);
  await waitForPageReady(page, options);
  if (options.waitFor) {
    await page.locator(options.waitFor).waitFor({
      state: 'visible',
      timeout: options.timeout || 10000,
    });
  }
}

/**
 * Open the session tree overlay on the session detail page.
 * Clicks the tree handle and waits for the overlay to be fully rendered
 * (including the transition animation and overlay header).
 * Returns a Locator scoped to the overlay container.
 */
export async function openSessionOverlay(page: Page, timeout = 10000) {
  const handle = page.locator('[data-testid="session-chat-handle"]');
  await handle.waitFor({ state: 'visible', timeout });
  await handle.click();
  const overlay = page.locator('.session-chat-overlay');
  await overlay.waitFor({ state: 'visible', timeout });
  // Wait for the overlay header to be visible — this ensures the transition
  // animation has completed and the overlay content is fully rendered,
  // eliminating the need for callers to add waitForTimeout() after this call.
  await overlay.locator('.overlay-header').waitFor({ state: 'visible', timeout });
  return overlay;
}

/**
 * Navigate to a session detail page and open the session tree overlay.
 * Combines navigateAndWait + openSessionOverlay for convenience.
 * Returns the overlay Locator.
 */
export async function navigateAndOpenOverlay(
  page: Page,
  url: string,
  options: { timeout?: number; waitFor?: string } = {},
) {
  await navigateAndWait(page, url, options);
  return openSessionOverlay(page, options.timeout || 10000);
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
  await page.getByText(text).waitFor({ state: 'visible', timeout });
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

export async function getAllCanvasItems(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/canvas/all`);
  if (!response.ok) return [];
  return response.json();
}

export async function getCanvasTrash(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/canvas-trash`);
  if (!response.ok) return [];
  return response.json();
}

export async function getCanvasFileContent(sessionId: string, filename: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/canvas/file/${encodeURIComponent(filename)}/content`);
  if (!response.ok) return null;
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
  data: { prompt: string; name?: string; mode?: string; model?: string; startImmediately?: boolean; gitMode?: string; gitBranch?: string; parentSessionId?: string; effortLevel?: string }
) {
  // Default gitMode/gitBranch so tests pass for git-repo-backed projects
  const payload = {
    gitMode: 'none',
    gitBranch: 'main',
    ...data,
  };
  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
  // Auto-generate a filename if not provided (required for inline content mode)
  const defaultExtensions: Record<string, string> = {
    markdown: 'md',
    text: 'txt',
    json: 'json',
    code: 'ts',
  };
  const payload = { ...data };
  if (!payload.filename && !payload.filePath && payload.content !== undefined) {
    const ext = defaultExtensions[payload.type] ?? 'txt';
    payload.filename = `seed-${Date.now()}.${ext}`;
  }
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/canvas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to seed canvas item (${response.status}): ${text}`);
  }
  return response.json();
}

export async function cleanupAll() {
  const projectsResponse = await fetch(`${API_URL}/api/projects`);
  if (!projectsResponse.ok) return;

  const projects = await projectsResponse.json();
  for (const project of projects) {
    // Only delete test projects created by this worker (prefixed with TEST_PREFIX)
    if (project.name.startsWith(TEST_PREFIX)) {
      await fetch(`${API_URL}/api/projects/${project.id}`, { method: 'DELETE' });
    }
  }

  // Delete providers created by this worker only (uses per-worker TEST_PREFIX).
  // This is safe for parallel execution — each worker only cleans up its own providers.
  // For a broader sweep (e.g. global-setup/teardown), use cleanupAllBroadly().
  const providersResponse = await fetch(`${API_URL}/api/providers`);
  if (!providersResponse.ok) return;

  const providers = await providersResponse.json();
  for (const provider of providers) {
    if (provider.name.startsWith(TEST_PREFIX) && !provider.isBuiltIn) {
      await fetch(`${API_URL}/api/providers/${provider.id}`, { method: 'DELETE' });
    }
  }
}

/**
 * Broadly clean up ALL test resources across all workers.
 * Only safe to call from global-setup and global-teardown, which run
 * sequentially (not in parallel with any workers).
 */
export async function cleanupAllBroadly() {
  const projectsResponse = await fetch(`${API_URL}/api/projects`);
  if (!projectsResponse.ok) return;

  const projects = await projectsResponse.json();
  for (const project of projects) {
    if (project.name.startsWith('[TEST') || project.name.startsWith(TEST_PREFIX)) {
      await fetch(`${API_URL}/api/projects/${project.id}`, { method: 'DELETE' });
    }
  }

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

export async function seedPartialText(
  sessionId: string,
  text: string
) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/partial-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error('Failed to seed partial text');
  return response.json();
}

export async function seedThinking(
  sessionId: string,
  thinking: string
) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/thinking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thinking }),
  });
  if (!response.ok) throw new Error('Failed to seed thinking');
  return response.json();
}

export async function updateSessionStatus(sessionId: string, status: string) {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error('Failed to update session status');
      return response.json();
    } catch (err: any) {
      if (attempt < maxRetries - 1 && (err?.cause?.code === 'ECONNRESET' || err?.message?.includes('fetch failed'))) {
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
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

export async function updateSessionFields(sessionId: string, fields: Record<string, any>) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update session fields: ${response.status} ${err}`);
  }
  return response.json();
}

// ============================================================
// Template Helpers
// ============================================================

export async function seedProjectTemplate(
  projectId: string,
  data: { name: string; prompt: string; nextTemplateId?: string; thinkingEnabled?: boolean | null; gitBranch?: string; model?: string; mode?: string | null; gitMode?: string; effortLevel?: string | null }
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
  thinkingEnabled?: boolean | null;
  gitBranch?: string;
  model?: string;
  mode?: string | null;
  gitMode?: string;
  effortLevel?: string | null;
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
  const data = await response.json();
  // API returns { project: Array, global: Array }, return just project templates
  return Array.isArray(data) ? data : (data.project || []);
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
    effortLevel?: string | null;
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
  data: { prompt: string; name?: string; mode?: string; effortLevel?: string | null },
  files: Array<{ name: string; content: string; type: string }>
) {
  const formData = new FormData();
  formData.append('prompt', data.prompt);
  if (data.name) formData.append('name', data.name);
  if (data.mode) formData.append('mode', data.mode);
  if (data.effortLevel !== undefined) {
    formData.append('effortLevel', data.effortLevel ?? '');
  }

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
 * Kill a running command via POST /api/sessions/:sessionId/command-buttons/runs/:runId/kill.
 * Returns the full fetch Response so callers can check response.ok / response.status
 * for both success and 404 (already-completed) cases.
 */
export async function killCommandRun(sessionId: string, runId: string): Promise<Response> {
  return fetch(`${API_URL}/api/sessions/${sessionId}/command-buttons/runs/${runId}/kill`, {
    method: 'POST',
  });
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

/**
 * Delete a command run via the API.
 * Returns the fetch response for testing error cases.
 */
export async function deleteCommandRun(sessionId: string, runId: string): Promise<Response> {
  return fetch(`${API_URL}/api/sessions/${sessionId}/command-buttons/runs/${runId}`, {
    method: 'DELETE',
  });
}

/**
 * Click a status indicator in SessionHeaderPanel to open the button status modal.
 * Uses the clickable status indicators in .command-status-bar.
 * @param page - Playwright page object
 * @param buttonLabel - Label of the button to click (used for title matching)
 */
export async function openButtonStatusModal(page: Page, buttonLabel: string) {
  // First, wait for the command status bar to be attached to the DOM
  await page.locator('.command-status-bar').waitFor({ state: 'attached', timeout: 10000 });

  // Find the status indicator for the specific button by its title attribute
  // The title format is "Label: status" (e.g., "Test Button: success")
  const statusIndicator = page.locator(
    `.command-status-bar .button-status-indicator[title*="${buttonLabel}"]`
  ).first();

  // Wait for the indicator to be visible before clicking
  await statusIndicator.waitFor({ state: 'visible', timeout: 15000 });

  // Click the indicator to open the modal
  await statusIndicator.click();

  // Wait for the modal to appear
  await page.locator('[data-testid="button-status-modal"]').waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Remove a command run via the UI (clicks remove, confirms).
 * @param page - Playwright page object
 * @param buttonLabel - Label of the button whose run should be removed
 */
export async function removeCommandRunViaUI(page: Page, buttonLabel: string) {
  // Open the modal first
  await openButtonStatusModal(page, buttonLabel);

  // Click "Remove Run" button
  await page.locator('[data-testid="remove-run-button"]').click();

  // Wait for confirmation dialog to appear
  await page.locator('[data-testid="confirm-remove-button"]').waitFor({ state: 'visible', timeout: 3000 });

  // Click "Confirm" button
  await page.locator('[data-testid="confirm-remove-button"]').click();

  // Wait for modal to close (it should close after successful deletion)
  await page.locator('[data-testid="button-status-modal"]').waitFor({ state: 'hidden', timeout: 5000 });
}

/**
 * Verify a run is deleted from the database.
 * Checks both the command_runs table and the session's latestCommandRuns array.
 * @param sessionId - Session ID
 * @param runId - Run ID that should be deleted
 */
export async function verifyRunDeleted(sessionId: string, runId: string) {
  // Check command_runs table - run should not exist
  const run = await getCommandRun(sessionId, runId);
  if (run !== null) {
    throw new Error(`Run ${runId} still exists in command_runs table`);
  }

  // Check session's latestCommandRuns array - run should not be present
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // latestCommandRuns may be null or an array
  const latestRuns = session.latestCommandRuns || [];
  const runInLatest = latestRuns.find((r: any) => r.runId === runId);
  if (runInLatest) {
    throw new Error(`Run ${runId} still exists in session's latestCommandRuns array`);
  }
}

/**
 * Wait for command completion in the UI and verify status.
 * Waits for the status indicator to show success or error (not running).
 * @param page - Playwright page object
 * @param buttonLabel - Label of the button to check
 * @param timeout - Maximum time to wait in ms (default 15000)
 * @returns The final status ('success' or 'error')
 */
export async function waitForCommandCompletion(
  page: Page,
  buttonLabel: string,
  timeout = 15000
): Promise<'success' | 'error'> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Wait for the status indicator to appear first
    try {
      const statusIndicator = page.locator(
        `.command-status-bar .button-status-indicator[title*="${buttonLabel}"]`
      ).first();

      // Wait for the indicator to be attached to DOM (not necessarily visible yet)
      await statusIndicator.waitFor({ state: 'attached', timeout: 2000 });

      // Get the current class list to determine status
      const className = await statusIndicator.getAttribute('class');

      if (className && className.includes('button-status-success')) {
        return 'success';
      }

      if (className && className.includes('button-status-error')) {
        return 'error';
      }

      if (className && className.includes('button-status-killed')) {
        return 'error';
      }

      if (className && className.includes('button-status-running')) {
        // Still running, wait and check again
        await page.waitForTimeout(500);
        continue;
      }

      // Status indicator exists but no recognized status class yet
      await page.waitForTimeout(500);
    } catch (e) {
      // Indicator not attached yet, wait and retry
      await page.waitForTimeout(500);
    }
  }

  throw new Error(`Command "${buttonLabel}" did not complete within ${timeout}ms`);
}

// ============================================================
// Model Provider Helpers
// ============================================================

/**
 * Create a model provider
 */
export async function createProvider(data: {
  name: string;
  baseUrl?: string;
  authToken?: string;
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
 * Add a model to a provider
 */
export async function addProviderModel(providerId: string, data: {
  modelId: string;
  displayName: string;
  tier?: 'opus' | 'sonnet' | 'haiku' | 'custom';
  description?: string;
}) {
  const response = await fetch(`${API_URL}/api/providers/${providerId}/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to add provider model (${response.status}): ${body}`);
  }
  return response.json();
}

/**
 * Remove a model from a provider (by model row ID)
 */
export async function removeProviderModel(providerId: string, modelRowId: string) {
  const response = await fetch(`${API_URL}/api/providers/${providerId}/models/${modelRowId}`, {
    method: 'DELETE',
  });
  return response.ok;
}

/**
 * Update a provider model (by model row ID)
 */
export async function updateProviderModel(providerId: string, modelRowId: string, data: {
  modelId?: string;
  displayName?: string;
  tier?: string;
}) {
  const response = await fetch(`${API_URL}/api/providers/${providerId}/models/${modelRowId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update provider model');
  return response.json();
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
 * Update a session's PR URL via PATCH.
 *
 * NOTE: Only `prUrl` is handled by the PATCH endpoint.
 * Other PR fields (prState, hasMergeConflicts, ciStatus) live in
 * session_summaries and must be seeded via seedSessionSummaryWithPR().
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
 * Uses PUT to directly seed summary data without triggering the generation flow
 */
export async function setSessionSummary(sessionId: string, summaryData: {
  shortSummary?: string;
  fullSummary?: string;
  keyActions?: string[];
  filesModified?: string[];
  outcome?: string;
  messageCount?: number;
  prMerged?: boolean;
  prState?: string;
  hasMergeConflicts?: boolean;
  ciStatus?: string;
  ciFailures?: string[];
}) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/summary`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summaryData),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to set session summary: ${response.status} ${response.statusText} - ${errorText}`);
  }
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

// ============================================================
// Conversation Management Helpers
// ============================================================

/**
 * Create a conversation for a session
 */
export async function seedConversation(sessionId: string, name?: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || null }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Failed to seed conversation: ${response.status}`);
  }
  return response.json();
}

/**
 * Create a conversation and return the raw response (for testing error cases)
 */
export async function seedConversationRaw(sessionId: string, name?: string) {
  return fetch(`${API_URL}/api/sessions/${sessionId}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || null }),
  });
}

/**
 * List all conversations for a session
 */
export async function getConversations(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/conversations`);
  if (!response.ok) return [];
  return response.json();
}

/**
 * Switch to a specific conversation (set as active)
 */
export async function switchConversation(sessionId: string, conversationId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/conversations/${conversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive: true }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Failed to switch conversation: ${response.status}`);
  }
  return response.json();
}

/**
 * Delete a conversation (returns raw response for testing error cases)
 */
export async function deleteConversationRaw(sessionId: string, conversationId: string) {
  return fetch(`${API_URL}/api/sessions/${sessionId}/conversations/${conversationId}`, {
    method: 'DELETE',
  });
}

/**
 * Delete a conversation
 */
export async function deleteConversation(sessionId: string, conversationId: string) {
  const response = await deleteConversationRaw(sessionId, conversationId);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Failed to delete conversation: ${response.status}`);
  }
  // 204 No Content
  return null;
}

/**
 * Branch from a message in a conversation
 */
export async function branchConversation(
  sessionId: string,
  conversationId: string,
  messageId: string,
  prompt: string
) {
  const response = await fetch(
    `${API_URL}/api/sessions/${sessionId}/conversations/${conversationId}/branch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, prompt }),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Failed to branch conversation: ${response.status}`);
  }
  return response.json();
}

/**
 * Get messages for a specific conversation
 */
export async function getConversationMessages(sessionId: string, conversationId: string) {
  const response = await fetch(
    `${API_URL}/api/sessions/${sessionId}/messages?conversation_id=${conversationId}`
  );
  if (!response.ok) return [];
  return response.json();
}

// ============================================================
// Message Seeding Helpers (for messaging-chat tests)
// Writes directly to the SQLite database via scripts/seed-message.mjs
// — no API endpoint needed.
// ============================================================

function getDBPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return join(process.cwd(), 'claudetools.db');
}

function runSeedMessage(payload: object): any {
  const seedScript = join(process.cwd(), 'scripts', 'seed-message.mjs');
  const input = JSON.stringify({ dbPath: getDBPath(), ...payload });
  const result = execSync(`node "${seedScript}"`, {
    input,
    encoding: 'utf-8',
    timeout: 10000,
  });
  return JSON.parse(result);
}

/**
 * Seed a user message directly into the DB for a session
 */
export function seedUserMessage(
  sessionId: string,
  content: string,
  conversationId?: string
) {
  return runSeedMessage({ sessionId, role: 'user', content, conversationId: conversationId ?? null });
}

/**
 * Seed an assistant message directly into the DB for a session
 */
export function seedAssistantMessage(
  sessionId: string,
  content: string,
  model?: string,
  conversationId?: string
) {
  return runSeedMessage({
    sessionId,
    role: 'assistant',
    content,
    model: model ?? null,
    conversationId: conversationId ?? null,
  });
}

/**
 * Seed an assistant message with tool use data directly into the DB for a session
 */
export function seedAssistantMessageWithTools(
  sessionId: string,
  content: string,
  toolUse: Array<{ type: string; id: string; name: string; input: Record<string, any> }>,
  model?: string,
  conversationId?: string
) {
  return runSeedMessage({
    sessionId,
    role: 'assistant',
    content,
    toolUse,
    model: model ?? null,
    conversationId: conversationId ?? null,
  });
}

/**
 * Seed multiple alternating user/assistant messages to create a scrollable conversation.
 * Uses a batch script to insert all messages in a single process/transaction
 * instead of spawning a separate process per message.
 */
export function seedConversationHistory(sessionId: string, messageCount: number) {
  const messages: any[] = [];
  for (let i = 0; i < messageCount; i++) {
    const isUser = i % 2 === 0;
    if (isUser) {
      messages.push({
        sessionId,
        role: 'user',
        content: `User message ${i + 1}: Tell me about topic ${i + 1}.`,
      });
    } else {
      messages.push({
        sessionId,
        role: 'assistant',
        content: `Assistant response ${i + 1}: Here is a detailed response about topic ${i}. `.repeat(5),
        model: 'claude-sonnet-4-20250514',
      });
    }
  }

  const seedScript = join(process.cwd(), 'scripts', 'seed-messages-batch.mjs');
  const input = JSON.stringify({ dbPath: getDBPath(), messages });
  const result = execSync(`node "${seedScript}"`, {
    input,
    encoding: 'utf-8',
    timeout: 30000,
  });
  return JSON.parse(result);
}

// ============================================================
// Template System Helpers (for template-system tests)
// ============================================================

/**
 * Find child sessions by querying the parent session's project sessions
 * and filtering by parentSessionId. Works without a dedicated /children endpoint.
 */
async function findChildSessionsForParent(parentSessionId: string): Promise<any[]> {
  // First get the parent session to find its projectId
  const parent = await getSession(parentSessionId);
  if (!parent) return [];

  const allSessions = await getProjectSessions(parent.projectId);
  return allSessions.filter((s: any) => s.parentSessionId === parentSessionId);
}

/**
 * Wait for a child session to appear under a parent session
 * Polls project sessions and filters by parentSessionId
 */
export async function waitForChildSession(
  parentSessionId: string,
  timeout = 15000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const children = await findChildSessionsForParent(parentSessionId);
    if (children.length > 0) {
      // Track for cleanup
      for (const child of children) {
        createdResources.sessions.add(child.id);
      }
      return children[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No child session found for parent ${parentSessionId} after ${timeout}ms`);
}

/**
 * Wait for N child sessions to appear under a parent session
 */
export async function waitForChildSessions(
  parentSessionId: string,
  count: number,
  timeout = 15000
): Promise<any[]> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const children = await findChildSessionsForParent(parentSessionId);
    if (children.length >= count) {
      for (const child of children) {
        createdResources.sessions.add(child.id);
      }
      return children;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Expected ${count} child sessions for parent ${parentSessionId}, found less after ${timeout}ms`);
}

/**
 * Seed a session summary directly into the DB via scripts/seed-summary.mjs
 */
export function seedSessionSummaryDirect(
  sessionId: string,
  data: {
    shortSummary: string;
    fullSummary: string;
    keyActions?: string[];
    filesModified?: string[];
    outcome?: string;
  }
) {
  const seedScript = join(process.cwd(), 'scripts', 'seed-summary.mjs');
  const input = JSON.stringify({ dbPath: getDBPath(), sessionId, ...data });
  const result = execSync(`node "${seedScript}"`, {
    input,
    encoding: 'utf-8',
    timeout: 10000,
  });
  return JSON.parse(result);
}

/**
 * Seed a session summary with PR status fields via extended seed-summary.mjs.
 * This is the PRIMARY way to seed PR state/CI data for tests.
 *
 * IMPORTANT: PR state fields (prState, ciStatus, etc.) live in
 * session_summaries, NOT sessions. Use updateSessionWithPR() for prUrl only,
 * and this function for everything else.
 */
export function seedSessionSummaryWithPR(
  sessionId: string,
  data: {
    shortSummary?: string;
    fullSummary?: string;
    outcome?: string;
    keyActions?: string[];
    filesModified?: string[];
    prState?: 'open' | 'merged' | 'closed' | 'draft';
    prMerged?: boolean;
    hasMergeConflicts?: boolean;
    ciStatus?: 'success' | 'failure' | 'pending';
    ciFailures?: string[];
  }
) {
  const seedScript = join(process.cwd(), 'scripts', 'seed-summary.mjs');
  const payload: any = {
    dbPath: getDBPath(),
    sessionId,
    shortSummary: data.shortSummary ?? 'Test summary',
    fullSummary: data.fullSummary ?? 'Test full summary',
    outcome: data.outcome ?? 'completed',
  };
  if (data.keyActions) payload.keyActions = data.keyActions;
  if (data.filesModified) payload.filesModified = data.filesModified;
  if (data.prState !== undefined) payload.prState = data.prState;
  if (data.prMerged !== undefined) payload.prMerged = data.prMerged;
  if (data.hasMergeConflicts !== undefined) payload.hasMergeConflicts = data.hasMergeConflicts;
  if (data.ciStatus !== undefined) payload.ciStatus = data.ciStatus;
  if (data.ciFailures !== undefined) payload.ciFailures = data.ciFailures;

  const input = JSON.stringify(payload);
  const result = execSync(`node "${seedScript}"`, {
    input,
    encoding: 'utf-8',
    timeout: 10000,
  });
  return JSON.parse(result);
}

/**
 * Update a session's nextTemplateId via PATCH
 */
export async function setNextTemplate(
  sessionId: string,
  nextTemplateId: string | null
): Promise<any> {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nextTemplateId }),
  });
  if (!response.ok) throw new Error('Failed to set next template');
  return response.json();
}

/**
 * Update a template via PATCH
 */
export async function updateTemplate(
  id: string,
  data: {
    name?: string;
    prompt?: string;
    nextTemplateId?: string | null;
    thinkingEnabled?: boolean | null;
    gitBranch?: string | null;
    gitMode?: string | null;
    model?: string | null;
    mode?: string | null;
    effortLevel?: string | null;
  }
): Promise<any> {
  const response = await fetch(`${API_URL}/api/templates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update template');
  return response.json();
}

// ============================================================
// Session Scheduling Helpers
// ============================================================

/**
 * Create a scheduled session with auto-reschedule configuration
 */
export async function seedScheduledSession(
  projectId: string,
  data: {
    prompt: string;
    name?: string;
    scheduledAt?: number;
    autoRescheduleEnabled?: boolean;
    rescheduleDelayMinutes?: number;
    rescheduleOnTokenLimit?: boolean;
    rescheduleOnServiceError?: boolean;
    maxRescheduleCount?: number | null;
    maxTotalTokens?: number | null;
    rescheduleAtTokenCount?: number | null;
  }
): Promise<any> {
  const body: any = {
    prompt: data.prompt,
    startImmediately: false,
    scheduledAt: data.scheduledAt || Date.now() + 3600000, // default 1 hour from now
  };
  if (data.name) body.name = data.name;
  if (data.autoRescheduleEnabled !== undefined) body.autoRescheduleEnabled = data.autoRescheduleEnabled;
  if (data.rescheduleDelayMinutes !== undefined) body.rescheduleDelayMinutes = data.rescheduleDelayMinutes;
  if (data.rescheduleOnTokenLimit !== undefined) body.rescheduleOnTokenLimit = data.rescheduleOnTokenLimit;
  if (data.rescheduleOnServiceError !== undefined) body.rescheduleOnServiceError = data.rescheduleOnServiceError;
  if (data.maxRescheduleCount !== undefined) body.maxRescheduleCount = data.maxRescheduleCount;
  if (data.maxTotalTokens !== undefined) body.maxTotalTokens = data.maxTotalTokens;
  if (data.rescheduleAtTokenCount !== undefined) body.rescheduleAtTokenCount = data.rescheduleAtTokenCount;

  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to seed scheduled session: ${response.status} ${err}`);
  }
  const session = await response.json();
  createdResources.sessions.add(session.id);
  return session;
}

/**
 * Update session scheduling fields via PATCH
 */
export async function updateSessionScheduling(
  sessionId: string,
  data: {
    scheduledAt?: number | null;
    autoRescheduleEnabled?: boolean;
    rescheduleDelayMinutes?: number;
    rescheduleOnTokenLimit?: boolean;
    rescheduleOnServiceError?: boolean;
    maxRescheduleCount?: number | null;
    maxTotalTokens?: number | null;
    rescheduleCount?: number;
    rescheduleAtTokenCount?: number | null;
    status?: string;
    pendingPrompt?: string;
  }
): Promise<any> {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update session scheduling: ${response.status} ${err}`);
  }
  return response.json();
}

/**
 * Get all scheduled sessions (optionally filtered by project)
 */
export async function getScheduledSessions(projectId?: string): Promise<any[]> {
  const url = projectId
    ? `${API_URL}/api/sessions/scheduled?projectId=${projectId}`
    : `${API_URL}/api/sessions/scheduled`;
  const response = await fetch(url);
  if (!response.ok) return [];
  return response.json();
}

/**
 * Wait for a session to reach 'scheduled' status
 */
export async function waitForSessionScheduled(
  sessionId: string,
  timeout = 10000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const session = await getSession(sessionId);
    if (session && session.status === 'scheduled') return session;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Session ${sessionId} did not reach 'scheduled' status after ${timeout}ms`);
}

/**
 * Update session pending prompt via the dedicated endpoint
 */
export async function updatePendingPrompt(
  sessionId: string,
  pendingPrompt: string | null
): Promise<any> {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/pending-prompt`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pendingPrompt }),
  });
  if (!response.ok) throw new Error('Failed to update pending prompt');
  return response.json();
}

// ============================================================
// Quick Response Helpers
// ============================================================

/**
 * Create a quick response via POST /api/projects/:projectId/quick-responses.
 * Returns the full response object.
 */
export async function seedQuickResponse(
  projectId: string,
  data: {
    label: string;
    content: string;
    autoSubmit?: boolean;
    category?: string;
    sortOrder?: number;
    isGlobal?: boolean;
  }
): Promise<any> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/quick-responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`seedQuickResponse failed: ${res.status}`);
  return res.json();
}

/**
 * Get all quick responses for a project (both project-scoped and global).
 * Returns { project: [...], global: [...] }.
 */
export async function getQuickResponses(projectId: string): Promise<any> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/quick-responses`);
  if (!res.ok) throw new Error(`getQuickResponses failed: ${res.status}`);
  return res.json();
}

/**
 * Update a quick response via PATCH /api/quick-responses/:id.
 * Returns the updated response object.
 */
export async function updateQuickResponse(
  id: string,
  data: { label?: string; content?: string; autoSubmit?: boolean; category?: string; sortOrder?: number }
): Promise<any> {
  const res = await fetch(`${API_URL}/api/quick-responses/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateQuickResponse failed: ${res.status}`);
  return res.json();
}

/**
 * Delete a quick response via DELETE /api/quick-responses/:id.
 */
export async function deleteQuickResponse(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/quick-responses/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`deleteQuickResponse failed: ${res.status}`);
}

/**
 * Reorder quick responses via POST /api/projects/:projectId/quick-responses/reorder
 * or POST /api/quick-responses/global/reorder.
 * Returns updated list.
 */
export async function reorderQuickResponses(
  projectId: string | null,
  orders: Array<{ id: string; sortOrder: number }>
): Promise<any> {
  const url = projectId
    ? `${API_URL}/api/projects/${projectId}/quick-responses/reorder`
    : `${API_URL}/api/quick-responses/global/reorder`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(orders),
  });
  if (!res.ok) throw new Error(`reorderQuickResponses failed: ${res.status}`);
  return res.json();
}

// ============================================================
// Slash Command Helpers
// ============================================================

/**
 * Get discovered slash commands for a directory via the API.
 * Returns array of command objects.
 */
export async function getSlashCommands(directory: string): Promise<any[]> {
  const res = await fetch(
    `${API_URL}/api/commands?directory=${encodeURIComponent(directory)}`
  );
  if (!res.ok) throw new Error(`getSlashCommands failed: ${res.status}`);
  return res.json();
}

/**
 * Get a specific slash command by name and directory.
 * Returns null if not found.
 */
export async function getSlashCommand(
  directory: string,
  name: string
): Promise<any> {
  const res = await fetch(
    `${API_URL}/api/commands/${encodeURIComponent(name)}?directory=${encodeURIComponent(directory)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getSlashCommand failed: ${res.status}`);
  return res.json();
}

/**
 * Seed token usage directly into the DB for a session ( Uses scripts/seed-session-tokens.mjs.
 */
export function seedSessionTokens(
  sessionId: string,
  tokens: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  }
): any {
  const seedScript = join(process.cwd(), 'scripts', 'seed-session-tokens.mjs');
  const payload = {
    dbPath: getDBPath(),
    sessionId,
    ...tokens,
  };
  const input = JSON.stringify(payload);
  const result = execSync(`node "${seedScript}"`, {
    input,
    encoding: 'utf-8',
    timeout: 10000,
  });
  return JSON.parse(result);
}

/**
 * Execute a slash command via the API (raw response for testing error cases).
 */
export async function executeSlashCommandRaw(
  name: string,
  sessionId: string,
  args: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${API_URL}/api/commands/${encodeURIComponent(name)}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, args }),
  });
}

/**
 * Get the slash commands API URL (for raw fetch calls in tests)
 */
export function getSlashCommandsAPIURL(): string {
  return `${API_URL}/api/commands`;
}

// ============================================================
// Todo Tracking Helpers (for todo-tracking tests)
// ============================================================

/**
 * Seed todos directly into the DB via scripts/seed-todos.mjs
 */
export function seedTodos(
  sessionId: string,
  conversationId: string,
  todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>
): any[] {
  const seedScript = join(process.cwd(), 'scripts', 'seed-todos.mjs');
  const payload = {
    dbPath: getDBPath(),
    sessionId,
    conversationId,
    todos,
  };
  const input = JSON.stringify(payload);
  const result = execSync(`node "${seedScript}"`, {
    input,
    encoding: 'utf-8',
    timeout: 10000,
  });
  return JSON.parse(result);
}

/**
 * Get todos for a session via API
 * If conversationId is provided, filters to that conversation
 */
export async function getTodos(
  sessionId: string,
  conversationId?: string
): Promise<any[]> {
  const url = conversationId
    ? `${API_URL}/api/sessions/${sessionId}/todos?conversation_id=${conversationId}`
    : `${API_URL}/api/sessions/${sessionId}/todos`;
  const response = await fetch(url);
  if (!response.ok) return [];
  return response.json();
}

// ============================================================
// Token Usage & Cost Helpers (for token-usage-cost tests)
// ============================================================

/**
 * Seed token usage directly into the DB for a conversation.
 * Uses scripts/seed-conversation-tokens.mjs for direct DB write.
 * If conversationId is not provided, uses the active conversation for the session.
 */
export function seedConversationTokens(
  sessionId: string,
  conversationId: string | null,
  tokens: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    contextWindow?: number;
  }
): any {
  const seedScript = join(process.cwd(), 'scripts', 'seed-conversation-tokens.mjs');
  const payload = {
    dbPath: getDBPath(),
    sessionId,
    conversationId: conversationId ?? null,
    ...tokens,
  };
  const input = JSON.stringify(payload);
  const result = execSync(`node "${seedScript}"`, {
    input,
    encoding: 'utf-8',
    timeout: 10000,
  });
  return JSON.parse(result);
}

/**
 * Get token cost weights from the API.
 * Returns { input, output, cacheRead, cacheCreation }.
 */
export async function getTokenWeights(): Promise<{
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}> {
  const response = await fetch(`${API_URL}/api/settings/token-weights`);
  if (!response.ok) throw new Error(`getTokenWeights failed: ${response.status}`);
  return response.json();
}

/**
 * Update token cost weights via PUT /api/settings/token-weights.
 * Returns the updated weights object.
 */
export async function updateTokenWeights(weights: {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}): Promise<any> {
  const response = await fetch(`${API_URL}/api/settings/token-weights`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(weights),
  });
  if (!response.ok) throw new Error(`updateTokenWeights failed: ${response.status}`);
  return response.json();
}

/**
 * Reset token cost weights to defaults via DELETE /api/settings/token-weights.
 * Returns the default weights object.
 */
export async function resetTokenWeights(): Promise<any> {
  const response = await fetch(`${API_URL}/api/settings/token-weights`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(`resetTokenWeights failed: ${response.status}`);
  return response.json();
}

/**
 * Get summary settings from the API.
 * Returns { disableSessionSummaries, sessionTitlePrompt, defaultSessionTitlePrompt }.
 */
export async function getSummarySettings(): Promise<{
  disableSessionSummaries: boolean;
  sessionTitlePrompt: string;
  defaultSessionTitlePrompt: string;
}> {
  const response = await fetch(`${API_URL}/api/settings/summary`);
  if (!response.ok) throw new Error(`getSummarySettings failed: ${response.status}`);
  return response.json();
}

/**
 * Update summary settings via PUT /api/settings/summary.
 * Returns the updated settings object.
 */
export async function updateSummarySettings(settings: {
  disableSessionSummaries: boolean;
  sessionTitlePrompt: string;
}): Promise<any> {
  const response = await fetch(`${API_URL}/api/settings/summary`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error(`updateSummarySettings failed: ${response.status}`);
  return response.json();
}

/**
 * Reset summary settings to defaults via DELETE /api/settings/summary.
 * Returns the default settings object.
 */
export async function resetSummarySettings(): Promise<any> {
  const response = await fetch(`${API_URL}/api/settings/summary`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(`resetSummarySettings failed: ${response.status}`);
  return response.json();
}

// ============================================================
// WebSocket Helpers (for WebSocket E2E tests)
// ============================================================

// Derive WS URL from API_URL
export const WS_URL = API_URL.replace(/^http/, 'ws');

/**
 * Connect a raw WebSocket client to the server.
 * Uses require() lazily to avoid static-import side-effects during
 * Playwright's globalSetup / module-collection phase.
 */
export function connectWebSocket(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const WS = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WS(`${WS_URL}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
  });
}

/** Subscribe to a session via WebSocket */
export function subscribeToSession(ws: any, sessionId: string): void {
  ws.send(JSON.stringify({ type: 'subscribe:session', sessionId }));
}

/** Unsubscribe from a session via WebSocket */
export function unsubscribeFromSession(ws: any, sessionId: string): void {
  ws.send(JSON.stringify({ type: 'unsubscribe:session', sessionId }));
}

/** Subscribe to a project via WebSocket */
export function subscribeToProject(ws: any, projectId: string): void {
  ws.send(JSON.stringify({ type: 'subscribe:project', projectId }));
}

/** Unsubscribe from a project via WebSocket */
export function unsubscribeFromProject(ws: any, projectId: string): void {
  ws.send(JSON.stringify({ type: 'unsubscribe:project', projectId }));
}

/**
 * Wait for a specific WebSocket message type, with optional payload matcher.
 * Resolves with the first matching message object.
 */
export function waitForWSMessage(
  ws: any,
  messageType: string,
  timeout = 10000,
  matcher?: (data: any) => boolean
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timeout waiting for WS message: "${messageType}"`));
    }, timeout);

    function handler(raw: any) {
      let data: any;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      if (data.type === messageType && (!matcher || matcher(data))) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(data);
      }
    }

    ws.on('message', handler);
  });
}

/**
 * Collect all WebSocket messages received within a fixed duration window.
 */
export function collectWSMessages(ws: any, durationMs: number): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = [];
    function handler(raw: any) {
      try { messages.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
    }
    ws.on('message', handler);
    setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(messages);
    }, durationMs);
  });
}

/**
 * Collect WebSocket messages until a specific message type (and optional
 * matcher) is received. All messages — including the stop message — are
 * included in the returned array. Resolves on stop message or timeout.
 *
 * @param ws          The WebSocket connection
 * @param stopType    The message type that ends collection
 * @param timeout     Max wait time in ms (default 15 000)
 * @param stopMatcher Optional extra predicate on the stop message
 */
export function collectWSMessagesUntil(
  ws: any,
  stopType: string,
  timeout = 15000,
  stopMatcher?: (data: any) => boolean
): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = [];

    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      // Resolve with whatever we collected — callers inspect the contents
      resolve(messages);
    }, timeout);

    function handler(raw: any) {
      let data: any;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      messages.push(data);
      if (data.type === stopType && (!stopMatcher || stopMatcher(data))) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(messages);
      }
    }

    ws.on('message', handler);
  });
}

/**
 * Assert that no message of a specific type is received within a timeout window.
 */
export async function assertNoWSMessage(
  ws: any,
  messageType: string,
  timeout = 1000
): Promise<void> {
  let received = false;

  const handler = (raw: any) => {
    let data: any;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (data.type === messageType) {
      received = true;
      ws.removeListener('message', handler);
    }
  };

  ws.on('message', handler);
  await new Promise((r) => setTimeout(r, timeout));
  ws.removeListener('message', handler);

  if (received) {
    throw new Error(`Unexpected WS message "${messageType}" was received`);
  }
}

/**
 * Poll the REST API until the session reaches the target status.
 */
export async function waitForStatus(
  sessionId: string,
  status: string,
  timeout = 60000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const session = await getSession(sessionId);
    if (session && session.status === status) {
      return session;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Session ${sessionId} did not reach status "${status}" within ${timeout}ms`);
}

// ============================================================
// Agent Call Log Helpers
// ============================================================

/**
 * Seed an agent call log entry via POST /api/agent-calls.
 * Returns the created log entry with all fields (including computed totalTokens, durationMs).
 * Agent call logs are cleaned up automatically via ON DELETE CASCADE when the parent session
 * is deleted by cleanupCreatedResources().
 */
export async function seedAgentCallLog(
  sessionId: string,
  data?: {
    agentType?: string;
    callType?: string;
    model?: string | null;
    status?: string;
    inputTokens?: number;
    outputTokens?: number;
    thinkingTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    durationMs?: number | null;
    startedAt?: number | null;
    errorMessage?: string | null;
  }
) {
  const response = await fetch(`${API_URL}/api/agent-calls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, ...data }),
  });
  if (!response.ok) throw new Error(`Failed to seed agent call log: ${await response.text()}`);
  return response.json();
}

/**
 * Fetch agent call logs via GET /api/agent-calls with optional query params.
 */
export async function getAgentCallLogs(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const response = await fetch(`${API_URL}/api/agent-calls${qs}`);
  if (!response.ok) throw new Error('Failed to fetch agent call logs');
  const result = await response.json();
  // API returns { logs: [...], pagination: {...} }, extract just the logs array
  return result.logs || [];
}

/**
 * Fetch filter option values via GET /api/agent-calls/filter-options.
 */
export async function getAgentCallFilterOptions() {
  const response = await fetch(`${API_URL}/api/agent-calls/filter-options`);
  if (!response.ok) throw new Error('Failed to fetch filter options');
  return response.json();
}

// ============================================================
// Kanban Helpers
// ============================================================

/**
 * Seed a kanban lane for testing
 * Lanes are cleaned up automatically when the project is deleted (CASCADE)
 */
export async function seedKanbanLane(
  projectId: string,
  data: {
    name: string;
    sortOrder?: number;
  }
) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/kanban/lanes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create lane: ${response.status} ${errorText}`);
  }

  return await response.json();
}
