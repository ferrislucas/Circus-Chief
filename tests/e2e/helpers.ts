import { Page, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function getAPIURL(): string {
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
  return response.json();
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
  data: { label: string; command: string; sortOrder?: number }
) {
  const url = `${API_URL}/api/projects/${projectId}/command-buttons`;
  console.log(`[seedCommandButton] POST ${url}`);
  console.log(`[seedCommandButton] projectId: ${projectId}`);
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
  return response.json();
}
