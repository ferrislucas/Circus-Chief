<template>
  <div class="models-section">
    <div class="models-header">
      <span class="models-title">Models</span>
      <span class="models-hint">Assign tiers to map provider models to Opus / Sonnet / Haiku roles</span>
    </div>

    <div v-if="models.length > 0" class="models-list">
      <div class="model-row model-row-header">
        <span class="col-model-id">Model ID</span>
        <span class="col-display-name">Display Name</span>
        <span class="col-tier">Tier</span>
        <span class="col-actions"></span>
      </div>
      <div
        v-for="(model, index) in models"
        :key="index"
        class="model-row"
      >
        <input
          v-model="model.modelId"
          type="text"
          placeholder="anthropic.claude-3-sonnet-…"
          class="col-model-id model-input"
        />
        <input
          v-model="model.displayName"
          type="text"
          placeholder="My Sonnet"
          class="col-display-name model-input"
        />
        <select v-model="model.tier" class="col-tier model-input tier-select">
          <option value="opus">Opus</option>
          <option value="sonnet">Sonnet</option>
          <option value="haiku">Haiku</option>
          <option value="custom">Custom</option>
        </select>
        <button
          type="button"
          class="col-actions remove-model-btn"
          @click="$emit('remove', index)"
          title="Remove model"
        >
          ×
        </button>
      </div>
    </div>
    <div v-else class="models-empty">
      No models added yet.
    </div>

    <button type="button" class="btn btn-sm btn-secondary add-model-btn" @click="$emit('add')">
      + Add Model
    </button>
  </div>
</template>

<script setup>
defineProps({
  models: { type: Array, required: true },
});

defineEmits(['add', 'remove']);
</script>

<style scoped>
.models-section {
  margin-bottom: 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  overflow: hidden;
}

.models-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
}

.models-title {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--color-text);
}

.models-hint {
  font-size: 0.8125rem;
  color: var(--color-text-soft);
}

.models-list {
  padding: 0.5rem 0.75rem;
}

.model-row {
  display: grid;
  grid-template-columns: 1fr 10rem 6.5rem 2rem;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.375rem;
}

.model-row-header {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-soft);
  margin-bottom: 0.25rem;
}

.model-row-header span {
  padding: 0 0.25rem;
}

.model-input {
  padding: 0.4rem 0.6rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  color: var(--color-text);
  font-size: 0.8125rem;
}

.model-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.tier-select {
  appearance: auto;
  cursor: pointer;
}

.remove-model-btn {
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  font-size: 1.125rem;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
  line-height: 1;
  border-radius: 0.25rem;
  text-align: center;
}

.remove-model-btn:hover {
  color: var(--color-danger, #ef4444);
  border-color: var(--color-danger, #ef4444);
}

.models-empty {
  padding: 0.75rem 1rem;
  font-size: 0.8125rem;
  color: var(--color-text-soft);
  font-style: italic;
}

.add-model-btn {
  margin: 0.5rem 0.75rem 0.75rem;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-sm {
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
}

.btn-secondary {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-secondary:hover:not(:disabled) {
  border-color: var(--color-primary);
  background: var(--color-background-soft);
}
</style>
