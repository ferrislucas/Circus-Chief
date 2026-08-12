<template>
  <div class="layout-toggle">
    <button
      class="layout-toggle-btn"
      :class="{ active: layout === 'horizontal' }"
      title="Column layout"
      @click="$emit('select', 'horizontal')"
    >
      <KanbanBoardIcon name="columns" />
    </button>
    <button
      class="layout-toggle-btn"
      :class="{ active: layout === 'vertical' }"
      title="List layout"
      @click="$emit('select', 'vertical')"
    >
      <KanbanBoardIcon name="list" />
    </button>
  </div>
</template>

<script setup>
import KanbanBoardIcon from './KanbanBoardIcon.vue';

defineProps({ layout: { type: String, required: true } });
defineEmits(['select']);
</script>
