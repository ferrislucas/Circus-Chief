import { SHARED_DATA_API_VERSION } from '@circuschief/shared';
import { SharedDataError } from './sharedDataStore.js';

export class HttpDataStore {
  constructor(baseUrl, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.sessions = {
      getById: (id) => this.#request(`/sessions/${encodeURIComponent(id)}`),
      update: (id, data) => this.#request(`/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: data }),
      getScheduledDue: (now) => this.#request(`/sessions/due?now=${encodeURIComponent(now)}`),
      claimScheduled: (id, expectedScheduledAt, claimedAt) => this.#request(`/sessions/${encodeURIComponent(id)}/claim-scheduled`, { method: 'POST', body: { expectedScheduledAt, claimedAt } }),
    };
    this.messages = {
      getBySessionId: (id) => this.#request(`/sessions/${encodeURIComponent(id)}/messages`),
      getByConversationId: (id) => this.#request(`/conversations/${encodeURIComponent(id)}/messages`),
      create: (sessionId, role, content, options = {}) => this.#request('/messages', { method: 'POST', body: { sessionId, role, content, ...options } }),
    };
    this.conversations = { getActiveBySessionId: (id) => this.#request(`/sessions/${encodeURIComponent(id)}/active-conversation`) };
    this.projects = { getById: (id) => this.#request(`/projects/${encodeURIComponent(id)}`) };
    this.attachments = {
      getBySessionId: (id) => this.#request(`/sessions/${encodeURIComponent(id)}/attachments`),
      updateMessageIdForSession: (sessionId, messageId) => this.#request(`/sessions/${encodeURIComponent(sessionId)}/attachments/message`, { method: 'PATCH', body: { messageId } }),
    };
  }

  async verifyVersion() {
    const response = await this.#request('/version');
    if (response.version !== SHARED_DATA_API_VERSION) {
      throw new SharedDataError('UNSUPPORTED_VERSION', `Expected shared-data API v${SHARED_DATA_API_VERSION}, received v${response.version}`);
    }
    return response;
  }

  async #request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/internal/data/v1${path}`, {
        method, signal: controller.signal,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new SharedDataError(json.code || 'TRANSPORT_ERROR', json.message || `HTTP ${response.status}`, json.details);
      return json;
    } catch (error) {
      if (error instanceof SharedDataError) throw error;
      throw new SharedDataError(error.name === 'AbortError' ? 'TIMEOUT' : 'TRANSPORT_ERROR', error.message);
    } finally {
      clearTimeout(timeout);
    }
  }
}
