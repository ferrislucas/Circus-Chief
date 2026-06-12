<template>
  <div class="template-list-view">
    <TemplatesPanel :project-id="route.params.id" />
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router';
import TemplatesPanel from '../components/TemplatesPanel.vue';

const route = useRoute();
</script>
