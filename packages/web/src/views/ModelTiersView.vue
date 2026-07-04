<template>
  <div class="model-tiers-view">
    <div class="header">
      <h2>Model Tiers</h2>
      <button
        class="btn-primary"
        @click="openCreateModal"
      >
        + New Tier
      </button>
    </div>

    <p class="description">
      A model tier is an ordered list of models from one or more providers. Sessions bound to a
      tier automatically start on the first healthy member, failing over to subsequent members if
      the preferred one is unavailable.
    </p>

    <div
      v-if="tiersStore.loading && tiersStore.tiers.length === 0"
      class="loading"
    >
      Loading…
    </div>

    <div
      v-else-if="tiersStore.tiers.length === 0"
      class="empty-state"
    >
      No model tiers yet. Create one to enable automatic failover across providers.
    </div>

    <div
      v-else
      class="tiers-list"
    >
      <div
        v-for="tier in tiersStore.tiers"
        :key="tier.id"
        class="tier-card"
      >
        <div class="tier-header">
          <div class="tier-info">
            <span class="tier-name">{{ tier.name }}</span>
            <span class="tier-meta">{{ tier.members.length }} member{{ tier.members.length === 1 ? '' : 's' }}</span>
            <span
              v-if="tier.description"
              class="tier-description"
            >{{ tier.description }}</span>
          </div>
          <div class="tier-actions">
            <button
              class="btn-ghost"
              @click="openEditModal(tier)"
            >
              Edit
            </button>
            <button
              class="btn-danger-ghost"
              @click="confirmDelete(tier)"
            >
              Delete
            </button>
          </div>
        </div>

        <div
          v-if="tier.members.length > 0"
          class="members-list"
        >
          <div
            v-for="(member, idx) in tier.members"
            :key="member.id"
            class="member-row"
          >
            <span class="member-position">{{ idx + 1 }}</span>
            <span class="member-info">
              <span class="member-model">{{ member.modelId }}</span>
              <span class="member-provider">{{ providerName(member.providerId) }}</span>
            </span>
          </div>
        </div>
        <div
          v-else
          class="members-empty"
        >
          No members — add models to use this tier in sessions.
        </div>
      </div>
    </div>

    <!-- Create / Edit modal -->
    <div
      v-if="showModal"
      class="modal-overlay"
      @click.self="closeModal"
    >
      <div class="modal">
        <h3>{{ editingTier ? 'Edit Tier' : 'New Tier' }}</h3>

        <div class="form-group">
          <label for="tier-name">Name <span class="required">*</span></label>
          <input
            id="tier-name"
            v-model="form.name"
            type="text"
            placeholder="e.g. High Priority"
            maxlength="100"
            class="input"
          >
        </div>

        <div class="form-group">
          <label for="tier-description">Description</label>
          <input
            id="tier-description"
            v-model="form.description"
            type="text"
            placeholder="Optional description"
            class="input"
          >
        </div>

        <!-- Members -->
        <div class="members-section">
          <div class="members-section-header">
            <span>Members <span class="hint">(ordered by priority)</span></span>
          </div>

          <div
            v-if="form.members.length === 0"
            class="members-empty"
          >
            No members yet. Add a model below.
          </div>

          <div
            v-for="(member, idx) in form.members"
            :key="idx"
            class="member-edit-row"
          >
            <span class="member-position">{{ idx + 1 }}</span>
            <span class="member-edit-info">
              <span class="member-model">{{ member.modelId }}</span>
              <span class="member-provider">{{ providerName(member.providerId) }}</span>
            </span>
            <div class="member-controls">
              <button
                :disabled="idx === 0"
                class="btn-icon"
                title="Move up"
                @click="moveMemberUp(idx)"
              >
                ↑
              </button>
              <button
                :disabled="idx === form.members.length - 1"
                class="btn-icon"
                title="Move down"
                @click="moveMemberDown(idx)"
              >
                ↓
              </button>
              <button
                class="btn-icon btn-icon-danger"
                title="Remove"
                @click="removeMember(idx)"
              >
                ✕
              </button>
            </div>
          </div>

          <!-- Add member -->
          <div class="add-member-row">
            <select
              v-model="newMemberKey"
              class="member-select"
            >
              <option value="">
                — Select a model to add —
              </option>
              <optgroup
                v-for="provider in addableProviders"
                :key="provider.id"
                :label="provider.name"
              >
                <option
                  v-for="model in provider.models"
                  :key="`${provider.id}::${model.modelId}`"
                  :value="`${provider.id}::${model.modelId}`"
                >
                  {{ model.displayName || model.modelId }}
                </option>
              </optgroup>
            </select>
            <button
              :disabled="!newMemberKey"
              class="btn-secondary"
              @click="addMember"
            >
              Add
            </button>
          </div>
        </div>

        <div
          v-if="modalError"
          class="error-message"
        >
          {{ modalError }}
        </div>

        <div class="modal-actions">
          <button
            class="btn-ghost"
            @click="closeModal"
          >
            Cancel
          </button>
          <button
            :disabled="!form.name || saving"
            class="btn-primary"
            @click="saveTier"
          >
            {{ saving ? 'Saving…' : (editingTier ? 'Save changes' : 'Create tier') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Confirm delete modal -->
    <div
      v-if="confirmingDelete"
      class="modal-overlay"
      @click.self="confirmingDelete = null"
    >
      <div class="modal modal-sm">
        <h3>Delete tier?</h3>
        <p>
          Are you sure you want to delete <strong>{{ confirmingDelete.name }}</strong>? Sessions
          currently bound to this tier will lose their tier assignment.
        </p>
        <div class="modal-actions">
          <button
            class="btn-ghost"
            @click="confirmingDelete = null"
          >
            Cancel
          </button>
          <button
            :disabled="deleting"
            class="btn-danger"
            @click="doDelete"
          >
            {{ deleting ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useTiersStore } from '../stores/tiers.js';
import { useProvidersStore } from '../stores/providers.js';
import { useUiStore } from '../stores/ui.js';

const tiersStore = useTiersStore();
const providersStore = useProvidersStore();
const uiStore = useUiStore();

// ── Data ────────────────────────────────────────────────────────────────────
const showModal = ref(false);
const editingTier = ref(null);
const saving = ref(false);
const modalError = ref('');

const form = ref({ name: '', description: '', members: [] });
const newMemberKey = ref('');

const confirmingDelete = ref(null);
const deleting = ref(false);

// ── Computed ────────────────────────────────────────────────────────────────
const addableProviders = computed(() =>
  providersStore.providers
    .filter((p) => p.enabled !== false && p.models && p.models.length > 0)
    .map((p) => ({ ...p }))
);

function providerName(providerId) {
  const p = providersStore.providers.find((x) => x.id === providerId);
  return p ? p.name : providerId;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([
    tiersStore.tiers.length === 0 ? tiersStore.fetchTiers() : Promise.resolve(),
    providersStore.providers.length === 0 ? providersStore.fetchProviders() : Promise.resolve(),
  ]);
});

// ── Modal helpers ────────────────────────────────────────────────────────────
function openCreateModal() {
  editingTier.value = null;
  form.value = { name: '', description: '', members: [] };
  newMemberKey.value = '';
  modalError.value = '';
  showModal.value = true;
}

function openEditModal(tier) {
  editingTier.value = tier;
  form.value = {
    name: tier.name,
    description: tier.description || '',
    members: tier.members.map((m, i) => ({ ...m, position: i })),
  };
  newMemberKey.value = '';
  modalError.value = '';
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingTier.value = null;
  modalError.value = '';
}

// ── Member management ────────────────────────────────────────────────────────
function addMember() {
  if (!newMemberKey.value) return;
  const [providerId, ...rest] = newMemberKey.value.split('::');
  const modelId = rest.join('::');
  form.value.members.push({ providerId, modelId, position: form.value.members.length });
  newMemberKey.value = '';
}

function removeMember(idx) {
  form.value.members.splice(idx, 1);
  reindexMembers();
}

function moveMemberUp(idx) {
  if (idx === 0) return;
  const m = form.value.members;
  [m[idx - 1], m[idx]] = [m[idx], m[idx - 1]];
  reindexMembers();
}

function moveMemberDown(idx) {
  const m = form.value.members;
  if (idx === m.length - 1) return;
  [m[idx], m[idx + 1]] = [m[idx + 1], m[idx]];
  reindexMembers();
}

function reindexMembers() {
  const members = form.value.members;
  for (let i = 0; i < members.length; i++) {
    members[i].position = i;
  }
}

// ── Save ─────────────────────────────────────────────────────────────────────
async function saveTier() {
  if (!form.value.name) return;
  saving.value = true;
  modalError.value = '';

  const payload = {
    name: form.value.name,
    description: form.value.description || null,
    members: form.value.members.map((m, i) => ({
      providerId: m.providerId,
      modelId: m.modelId,
      position: i,
    })),
  };

  try {
    if (editingTier.value) {
      await tiersStore.updateTier(editingTier.value.id, payload);
      uiStore.showSuccess('Tier updated');
    } else {
      await tiersStore.createTier(payload);
      uiStore.showSuccess('Tier created');
    }
    closeModal();
  } catch (err) {
    modalError.value = err.message || 'Failed to save tier';
  } finally {
    saving.value = false;
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────
function confirmDelete(tier) {
  confirmingDelete.value = tier;
}

async function doDelete() {
  if (!confirmingDelete.value) return;
  deleting.value = true;
  try {
    await tiersStore.deleteTier(confirmingDelete.value.id);
    uiStore.showSuccess('Tier deleted');
    confirmingDelete.value = null;
  } catch (err) {
    uiStore.showError(err.message || 'Failed to delete tier');
  } finally {
    deleting.value = false;
  }
}
</script>


<style scoped src="./ModelTiersView.css"></style>
