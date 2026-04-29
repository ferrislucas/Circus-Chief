<template>
  <div class="container">
    <div class="page-header">
      <button
        class="btn btn-primary"
        @click="openCreateModal"
      >
        <span>+ Add Provider</span>
      </button>
    </div>

    <p class="page-description">
      Configure custom model providers to use the agent through alternative endpoints like AWS Bedrock,
      Google Vertex AI, or self-hosted proxies.
    </p>

    <div
      v-if="providersStore.loading"
      class="skeleton-list"
    >
      <div
        v-for="i in 3"
        :key="i"
        class="skeleton card"
        style="height: 120px"
      />
    </div>

    <div
      v-else-if="providersStore.error"
      class="error-message"
    >
      {{ providersStore.error }}
    </div>

    <div
      v-else
      class="provider-list"
    >
      <div
        v-for="provider in providersStore.providers"
        :key="provider.id"
        class="provider-card card"
      >
        <div class="provider-header">
          <div class="provider-title">
            <h3>
              {{ provider.name }}
              <span
                v-if="provider.isBuiltIn"
                class="built-in-badge"
              >Built-in</span>
            </h3>
          </div>
          <div class="provider-actions">
            <button
              class="btn btn-sm"
              :disabled="testingProviderId === provider.id"
              title="Test Connection"
              @click="testProvider(provider.id)"
            >
              {{ testingProviderId === provider.id ? 'Testing...' : 'Test' }}
            </button>
            <button
              class="btn btn-sm"
              @click="provider.isBuiltIn ? openAttributionModal(provider) : openEditModal(provider)"
            >
              {{ provider.isBuiltIn ? 'Settings' : 'Edit' }}
            </button>
            <button
              v-if="!provider.isBuiltIn"
              class="btn btn-sm btn-danger"
              @click="confirmDelete(provider)"
            >
              Delete
            </button>
          </div>
        </div>

        <div class="provider-details">
          <div
            class="provider-detail"
          >
            <span class="detail-label">Commit attribution:</span>
            <span class="detail-value">
              {{ provider.commitAttributionOverride ? 'Custom attribution' : 'Agent default' }}
            </span>
          </div>
          <div
            v-if="provider.baseUrl"
            class="provider-detail"
          >
            <span class="detail-label">Base URL:</span>
            <code class="detail-value">{{ provider.baseUrl }}</code>
          </div>
          <div
            v-if="provider.defaultSonnetModel"
            class="provider-detail"
          >
            <span class="detail-label">Default Sonnet Model:</span>
            <code class="detail-value">{{ provider.defaultSonnetModel }}</code>
          </div>
          <div
            v-if="!provider.baseUrl && provider.isBuiltIn"
            class="provider-detail"
          >
            <span class="detail-value">{{ getBuiltInProviderDescription(provider) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Provider Form Modal -->
    <ProviderForm
      :is-open="isFormOpen"
      :provider="selectedProvider"
      :attribution-only="attributionOnly"
      @close="closeFormModal"
      @saved="handleProviderSaved"
    />

    <!-- Delete Confirmation Modal -->
    <div
      v-if="providerToDelete"
      class="modal-overlay"
      @click.self="providerToDelete = null"
    >
      <div class="modal confirm-modal">
        <div class="modal-header">
          <h2>Delete Provider</h2>
          <button
            type="button"
            class="close-btn"
            @click="providerToDelete = null"
          >
            ×
          </button>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to delete <strong>{{ providerToDelete.name }}</strong>?</p>
          <p class="warning-text">
            This action cannot be undone.
          </p>
        </div>
        <div class="modal-footer">
          <button
            type="button"
            class="btn btn-secondary"
            @click="providerToDelete = null"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-danger"
            :disabled="deleting"
            @click="deleteProvider"
          >
            {{ deleting ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useProvidersStore } from '../stores/providers.js';
import { useUiStore } from '../stores/ui.js';
import ProviderForm from '../components/ProviderForm.vue';

const providersStore = useProvidersStore();
const uiStore = useUiStore();

const isFormOpen = ref(false);
const selectedProvider = ref(null);
const attributionOnly = ref(false);
const providerToDelete = ref(null);
const deleting = ref(false);
const testingProviderId = ref(null);

onMounted(() => {
  providersStore.fetchProviders();
});

function openCreateModal() {
  selectedProvider.value = null;
  attributionOnly.value = false;
  isFormOpen.value = true;
}

function openEditModal(provider) {
  selectedProvider.value = provider;
  attributionOnly.value = false;
  isFormOpen.value = true;
}

function openAttributionModal(provider) {
  selectedProvider.value = provider;
  attributionOnly.value = true;
  isFormOpen.value = true;
}

function closeFormModal() {
  isFormOpen.value = false;
  selectedProvider.value = null;
  attributionOnly.value = false;
}

function handleProviderSaved() {
  closeFormModal();
  providersStore.fetchProviders();
}

function getBuiltInProviderDescription(provider) {
  if (provider.kind === 'openai') {
    return 'Uses official OpenAI API';
  }

  return 'Uses official Anthropic API';
}

async function testProvider(providerId) {
  testingProviderId.value = providerId;
  try {
    const result = await providersStore.testExistingProvider(providerId);
    if (result.success) {
      uiStore.success(`Connection successful (model: ${result.details.model})`);
    } else {
      uiStore.error(`Connection failed: ${result.message}`);
    }
  } catch (err) {
    uiStore.error(`Test failed: ${err.message}`);
  } finally {
    testingProviderId.value = null;
  }
}

function confirmDelete(provider) {
  providerToDelete.value = provider;
}

async function deleteProvider() {
  deleting.value = true;
  try {
    await providersStore.deleteProvider(providerToDelete.value.id);
    uiStore.success('Provider deleted');
    providerToDelete.value = null;
  } catch (err) {
    uiStore.error(`Failed to delete provider: ${err.message}`);
  } finally {
    deleting.value = false;
  }
}
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-bottom: 0.5rem;
}

.page-description {
  color: var(--color-text-soft);
  margin: 0 0 1.5rem;
  font-size: 0.875rem;
  line-height: 1.5;
}

.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.error-message {
  color: var(--color-error);
  padding: 1rem;
  background-color: rgba(248, 81, 73, 0.1);
  border-radius: var(--border-radius);
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.provider-card {
  padding: 1.25rem;
}

.provider-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.75rem;
  gap: 1rem;
}

.provider-title h3 {
  margin: 0;
  font-size: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.built-in-badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0;
  color: var(--color-text-soft);
}

.provider-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-shrink: 0;
}

.provider-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.provider-detail {
  display: flex;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.detail-label {
  color: var(--color-text-soft);
  font-weight: 500;
}

.detail-value {
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}

.btn-sm {
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
}

.btn-danger {
  background: var(--color-danger, #ef4444);
  border: 1px solid var(--color-danger, #ef4444);
  color: white;
}

.btn-danger:hover:not(:disabled) {
  filter: brightness(1.1);
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  width: 100%;
  max-width: 450px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.confirm-modal {
  max-width: 400px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0.25rem;
  line-height: 1;
  border-radius: 0.25rem;
}

.close-btn:hover {
  color: var(--color-text);
  background: var(--color-background-soft);
}

.modal-body {
  padding: 1.25rem;
}

.modal-body p {
  margin: 0 0 0.75rem;
}

.warning-text {
  color: var(--color-warning, #f59e0b);
  font-size: 0.875rem;
  font-weight: 500;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

@media (max-width: 520px) {
  .provider-card {
    padding: 1rem;
  }

  .provider-header,
  .provider-detail {
    flex-direction: column;
    align-items: stretch;
  }

  .provider-actions {
    justify-content: flex-start;
  }

  .modal-overlay {
    align-items: stretch;
  }

  .modal {
    max-width: none;
    max-height: none;
    min-height: 100vh;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
  }

  .modal-footer {
    justify-content: space-between;
  }
}
</style>
