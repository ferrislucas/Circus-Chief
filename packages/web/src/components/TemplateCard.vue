<template>
  <router-link
    :to="`/projects/${projectId}/templates/${template.id}`"
    class="template-card card"
    :data-testid="`template-card-${template.id}`"
  >
    <div class="template-header">
      <h4 class="template-name">
        {{ template.name }}
      </h4>
    </div>
    <p class="template-prompt">
      {{ truncatePrompt(template.prompt) }}
    </p>
    <div class="template-meta">
      <span
        v-if="isGlobal"
        class="meta-badge meta-badge-global"
      >Global</span>
      <span
        v-if="template.thinkingEnabled"
        class="meta-badge"
      >Thinking</span>
      <span
        v-if="template.gitBranch"
        class="meta-badge"
      >{{ template.gitBranch }}</span>
      <span
        v-if="template.model"
        class="meta-badge"
      >{{ getModelName(template.model) }}</span>
      <span
        v-if="template.mode"
        class="meta-badge"
      >{{ template.mode }}</span>
      <span
        v-if="template.nextTemplateId"
        class="meta-badge meta-badge-chain"
      >
        Chains to: {{ getTemplateName(template.nextTemplateId) }}
      </span>
      <span
        v-if="template.showInQuickResponses"
        class="meta-badge"
      >Quick Response</span>
      <span
        v-if="template.quickResponseAutoSubmit"
        class="meta-badge"
      >Auto-submit</span>
    </div>
  </router-link>
</template>

<script setup>
defineProps({
  template: { type: Object, required: true },
  projectId: { type: String, required: true },
  isGlobal: { type: Boolean, default: false },
  getModelName: { type: Function, required: true },
  getTemplateName: { type: Function, required: true },
});

function truncatePrompt(prompt, maxLength = 100) {
  if (prompt.length <= maxLength) return prompt;
  return `${prompt.substring(0, maxLength)  }...`;
}
</script>

<style scoped>
.template-card {
  padding: 1rem;
  text-decoration: none;
  color: inherit;
  display: block;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.template-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.template-header {
  margin-bottom: 0.5rem;
}

.template-name {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
}

.template-prompt {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-soft);
  line-height: 1.4;
}

.template-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.meta-badge {
  font-size: 0.7rem;
  padding: 0.15rem 0.4rem;
  background: var(--color-bg-soft);
  border-radius: 4px;
  color: var(--color-text-soft);
}

.meta-badge-global {
  background: var(--color-primary);
  color: white;
}

.meta-badge-chain {
  background: var(--color-warning, #f0ad4e);
  color: #333;
}
</style>
