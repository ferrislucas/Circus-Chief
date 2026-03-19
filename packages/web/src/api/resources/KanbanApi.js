/**
 * Kanban API resource mixin
 * Adds kanban board related methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function KanbanApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    // ============== Board Endpoints ==============

    /**
     * Get the full kanban board for a project (with all lanes and cards)
     * @param {string} projectId - Project ID
     * @returns {Promise<Object|null>} Full board or null if disabled
     */
    async getKanbanBoard(projectId) {
      return this._get(`/projects/${projectId}/kanban`);
    },

    /**
     * Delete the kanban board for a project (resets all data)
     * @param {string} projectId - Project ID
     * @returns {Promise<void>}
     */
    async deleteKanbanBoard(projectId) {
      return this._delete(`/projects/${projectId}/kanban`);
    },

    // ============== Lane Endpoints ==============

    /**
     * Create a new lane on the board
     * @param {string} projectId - Project ID
     * @param {Object} data - Lane data
     * @param {string} data.name - Lane name
     * @param {number} [data.sortOrder] - Sort order
     * @param {string|null} [data.onEnterTemplateId] - Template to run when card enters lane
     * @returns {Promise<Object>}
     */
    async createKanbanLane(projectId, data) {
      return this._post(`/projects/${projectId}/kanban/lanes`, data);
    },

    /**
     * Update a lane
     * @param {string} projectId - Project ID
     * @param {string} laneId - Lane ID
     * @param {Object} data - Updated lane data
     * @returns {Promise<Object>}
     */
    async updateKanbanLane(projectId, laneId, data) {
      return this._patch(`/projects/${projectId}/kanban/lanes/${laneId}`, data);
    },

    /**
     * Delete a lane
     * @param {string} projectId - Project ID
     * @param {string} laneId - Lane ID
     * @returns {Promise<void>}
     */
    async deleteKanbanLane(projectId, laneId) {
      return this._delete(`/projects/${projectId}/kanban/lanes/${laneId}`);
    },

    /**
     * Reorder lanes
     * @param {string} projectId - Project ID
     * @param {string[]} laneIds - Ordered array of lane IDs
     * @returns {Promise<Object>} Updated board
     */
    async reorderKanbanLanes(projectId, laneIds) {
      return this._put(`/projects/${projectId}/kanban/lanes/reorder`, laneIds);
    },

    // ============== Card Endpoints ==============

    /**
     * Add a session to the kanban board (create a card)
     * @param {string} projectId - Project ID
     * @param {Object} data - Card data
     * @param {string} data.sessionId - Session ID to add
     * @param {string} data.laneId - Lane to add the session to
     * @returns {Promise<Object>}
     */
    async createKanbanCard(projectId, data) {
      return this._post(`/projects/${projectId}/kanban/cards`, data);
    },

    /**
     * Move a card to a different lane
     * @param {string} projectId - Project ID
     * @param {string} cardId - Card ID
     * @param {Object} data - Move data
     * @param {string} data.targetLaneId - Target lane ID
     * @param {number} [data.sortOrder] - Optional sort order in target lane
     * @param {boolean} [data.runOnEnterTemplate=true] - Whether to run on-enter template
     * @returns {Promise<Object>}
     */
    async moveKanbanCard(projectId, cardId, data) {
      return this._patch(`/projects/${projectId}/kanban/cards/${cardId}/move`, data);
    },

    /**
     * Remove a card from the board
     * @param {string} projectId - Project ID
     * @param {string} cardId - Card ID
     * @returns {Promise<void>}
     */
    async deleteKanbanCard(projectId, cardId) {
      return this._delete(`/projects/${projectId}/kanban/cards/${cardId}`);
    },

    /**
     * Reorder cards within a lane
     * @param {string} projectId - Project ID
     * @param {string} laneId - Lane ID
     * @param {string[]} cardIds - Ordered array of card IDs
     * @returns {Promise<Object>} Success response
     */
    async reorderKanbanCards(projectId, laneId, cardIds) {
      return this._put(`/projects/${projectId}/kanban/lanes/${laneId}/cards/reorder`, cardIds);
    },
  });
}
