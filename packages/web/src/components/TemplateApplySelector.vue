<template>
  <div
    v-if="hasTemplates"
    class="template-apply-selector"
  >
    <select
      id="apply-template-select"
      :value="selectedTemplateId"
      class="form-input"
      :disabled="loading"
      title="Selecting a template will append its prompt and apply compatible session settings."
      @change="handleChange"
    >
      <option value="">
        Use a template...
      </option>
      <optgroup
        v-if="projectTemplates.length"
        label="Project Templates"
      >
        <option
          v-for="template in projectTemplates"
          :key="template.id"
          :value="template.id"
        >
          {{ template.name }}
        </option>
      </optgroup>
      <optgroup
        v-if="globalTemplates.length"
        label="Global Templates"
      >
        <option
          v-for="template in globalTemplates"
          :key="template.id"
          :value="template.id"
        >
          {{ template.name }}
        </option>
      </optgroup>
    </select>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useTemplatesStore } from '../stores/templates.js';

defineOptions({
  name: 'TemplateApplySelector',
});

const props = defineProps({
  projectId: { type: String, default: null },
});

const emit = defineEmits(['apply']);

const templatesStore = useTemplatesStore();
const selectedTemplateId = ref('');

const loading = computed(() => templatesStore.loading);
const projectTemplates = computed(() => templatesStore.projectTemplates || []);
const globalTemplates = computed(() => templatesStore.globalTemplates || []);
const hasTemplates = computed(() => projectTemplates.value.length > 0 || globalTemplates.value.length > 0);

onMounted(() => {
  const needsTemplates = props.projectId &&
    (templatesStore.currentProjectId !== props.projectId || !hasTemplates.value);

  if (needsTemplates && typeof templatesStore.fetchProjectTemplates === 'function') {
    templatesStore.fetchProjectTemplates(props.projectId);
  }
});

function handleChange(event) {
  const target = event?.target;
  const templateId = target?.value || selectedTemplateId.value;
  if (templateId) {
    emit('apply', templateId);
  }
  selectedTemplateId.value = '';
  if (target) {
    target.value = '';
  }
}

defineExpose({ handleChange });
</script>

<style scoped>
.template-apply-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.template-apply-selector .form-input {
  flex: 1;
  min-width: 12rem;
}
</style>
