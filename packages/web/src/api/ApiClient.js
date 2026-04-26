import {
  ProjectsApi,
  SessionsApi,
  CanvasApi,
  ProvidersApi,
  AgentsApi,
  CommandButtonsApi,
  SettingsApi,
  ConversationsApi,
  TemplatesApi,
  QuickResponsesApi,
  MiscApi,
  KanbanApi,
} from './resources/index.js';

/**
 * API client class for making HTTP requests to the backend.
 *
 * Resource methods are added via mixins from api/resources/.
 * The core class handles HTTP mechanics: request/response, FormData uploads,
 * query string construction, and convenience HTTP verb methods.
 */
export class ApiClient {
  #baseUrl;

  /**
   * Create a new API client
   * @param {string} baseUrl - Base URL for API requests
   */
  constructor(baseUrl = '/api') {
    this.#baseUrl = baseUrl;
  }

  /**
   * Get the base URL
   * @returns {string}
   */
  get baseUrl() {
    return this.#baseUrl;
  }

  /**
   * Make an HTTP request
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {Object} data - Request body data
   * @returns {Promise<any>}
   */
  async #request(method, path, data = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (data && method !== 'GET') {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(`${this.#baseUrl}${path}`, options);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  /**
   * POST a FormData body (for file uploads) and handle the response.
   * Exposed as a protected method so resource mixins can use it.
   * @param {string} path - API path
   * @param {FormData} formData - FormData body
   * @returns {Promise<any>}
   */
  async _uploadFormData(path, formData) {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * Build a path with query parameters from an object.
   * Undefined/null values are filtered out automatically.
   * @param {string} basePath - The base API path
   * @param {Object} params - Key-value pairs for query parameters
   * @returns {string} Path with query string appended (if any params)
   */
  _buildQueryPath(basePath, params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, value);
      }
    }
    const query = searchParams.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  /**
   * HTTP GET convenience method
   * @param {string} path - API path
   * @returns {Promise<any>}
   */
  _get(path) {
    return this.#request('GET', path);
  }

  /**
   * HTTP POST convenience method
   * @param {string} path - API path
   * @param {Object} [data] - Request body data
   * @returns {Promise<any>}
   */
  _post(path, data) {
    return this.#request('POST', path, data);
  }

  /**
   * HTTP PUT convenience method
   * @param {string} path - API path
   * @param {Object} [data] - Request body data
   * @returns {Promise<any>}
   */
  _put(path, data) {
    return this.#request('PUT', path, data);
  }

  /**
   * HTTP PATCH convenience method
   * @param {string} path - API path
   * @param {Object} [data] - Request body data
   * @returns {Promise<any>}
   */
  _patch(path, data) {
    return this.#request('PATCH', path, data);
  }

  /**
   * HTTP DELETE convenience method
   * @param {string} path - API path
   * @param {Object} [data] - Optional request body data
   * @returns {Promise<any>}
   */
  _delete(path, data) {
    return this.#request('DELETE', path, data);
  }
}

// Apply resource mixins
ProjectsApi(ApiClient);
SessionsApi(ApiClient);
CanvasApi(ApiClient);
ProvidersApi(ApiClient);
AgentsApi(ApiClient);
CommandButtonsApi(ApiClient);
SettingsApi(ApiClient);
ConversationsApi(ApiClient);
TemplatesApi(ApiClient);
QuickResponsesApi(ApiClient);
MiscApi(ApiClient);
KanbanApi(ApiClient);

// Singleton instance
export const api = new ApiClient();
