import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useProvidersStore = defineStore('providers', {
  state: () => ({
    providers: [],
    loading: false,
    error: null,
    testingConnection: false,
    testResult: null,
  }),

  getters: {
    customProviders: (state) => state.providers.filter((p) => !p.isBuiltIn),
    getById: (state) => (id) => state.providers.find((p) => p.id === id),

    // Get all models across all providers
    allModels: (state) => {
      const models = [];
      for (const provider of state.providers) {
        if (provider.models) {
          for (const model of provider.models) {
            models.push({
              ...model,
              providerName: provider.name,
              providerId: provider.id,
            });
          }
        }
      }
      return models;
    },
  },

  actions: {
    async fetchProviders() {
      this.loading = true;
      this.error = null;
      try {
        this.providers = await api.getProviders();
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchProvider(id) {
      this.loading = true;
      this.error = null;
      try {
        const provider = await api.getProvider(id);
        // Update in state if it exists
        const index = this.providers.findIndex((p) => p.id === id);
        if (index !== -1) {
          this.providers[index] = provider;
        }
        return provider;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async createProvider(data) {
      this.loading = true;
      this.error = null;
      try {
        const provider = await api.createProvider(data);
        this.providers.push(provider);
        return provider;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async updateProvider(id, updates) {
      this.loading = true;
      this.error = null;
      try {
        const updated = await api.updateProvider(id, updates);
        const index = this.providers.findIndex((p) => p.id === id);
        if (index !== -1) {
          this.providers[index] = updated;
        }
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async deleteProvider(id) {
      this.loading = true;
      this.error = null;
      try {
        await api.deleteProvider(id);
        this.providers = this.providers.filter((p) => p.id !== id);
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    // Connection testing
    async testConnection(config) {
      this.testingConnection = true;
      this.testResult = null;
      this.error = null;
      try {
        this.testResult = await api.testProviderConnection(config);
        return this.testResult;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.testingConnection = false;
      }
    },

    async testExistingProvider(id) {
      this.testingConnection = true;
      this.testResult = null;
      this.error = null;
      try {
        this.testResult = await api.testExistingProvider(id);
        return this.testResult;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.testingConnection = false;
      }
    },

    // Model management
    async fetchModels(providerId) {
      this.loading = true;
      this.error = null;
      try {
        return await api.getProviderModels(providerId);
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async addModel(providerId, model) {
      this.loading = true;
      this.error = null;
      try {
        return await api.addProviderModel(providerId, model);
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async removeModel(providerId, modelId) {
      this.loading = true;
      this.error = null;
      try {
        await api.removeProviderModel(providerId, modelId);
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    clearTestResult() {
      this.testResult = null;
    },
  },
});
