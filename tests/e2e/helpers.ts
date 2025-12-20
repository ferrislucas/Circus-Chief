import { Page, expect } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:5000';
const TEST_PREFIX = '[TEST] ';

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

// ============================================================
// Seeding Helpers
// ============================================================

export async function seedProject(name: string, workingDirectory: string) {
  const testName = `${TEST_PREFIX}${name}`;
  const response = await fetch(`${API_URL}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: testName, workingDirectory }),
  });
  if (!response.ok) throw new Error('Failed to seed project');
  return response.json();
}

export async function seedSession(
  projectId: string,
  data: { prompt: string; name?: string; mode?: string }
) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to seed session');
  return response.json();
}

export async function seedCanvasItem(
  sessionId: string,
  data: { type: string; content?: string; data?: string; mimeType?: string; label?: string; filePath?: string }
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
  await expect(async () => {
    const statusBadge = page.locator(`.status-badge.status-${status}`);
    await expect(statusBadge).toBeVisible();
  }).toPass({ timeout });
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
