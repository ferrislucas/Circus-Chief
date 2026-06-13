<template>
  <!-- eslint-disable vue/no-multiple-template-root -- conditional single-root svg per icon -->
  <svg
    v-if="name === 'columns'"
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <rect
      x="2"
      y="3"
      width="6"
      height="18"
      rx="1"
    />
    <rect
      x="10"
      y="3"
      width="6"
      height="18"
      rx="1"
    />
    <rect
      x="18"
      y="3"
      width="4"
      height="18"
      rx="1"
    />
  </svg>
  <svg
    v-else-if="name === 'list'"
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <line
      x1="3"
      y1="6"
      x2="21"
      y2="6"
    />
    <line
      x1="3"
      y1="12"
      x2="21"
      y2="12"
    />
    <line
      x1="3"
      y1="18"
      x2="21"
      y2="18"
    />
  </svg>
  <svg
    v-else-if="name === 'chevron'"
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  ><polyline points="9 18 15 12 9 6" /></svg>
  <svg
    v-else-if="name === 'automation'"
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="currentColor"
  ><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
  <svg
    v-else-if="name === 'settings'"
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle
      cx="12"
      cy="12"
      r="3"
    />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
  <svg
    v-else-if="name === 'schedule'"
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle
      cx="12"
      cy="12"
      r="10"
    />
    <polyline points="12 6 12 12 16 14" />
  </svg>
  <svg
    v-else-if="name === 'reorder-up'"
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  ><polyline points="18 15 12 9 6 15" /></svg>
  <svg
    v-else-if="name === 'reorder-down'"
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  ><polyline points="6 9 12 15 18 9" /></svg>
  <svg
    v-else-if="name === 'move'"
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polyline points="15 4 19 4 19 8" />
    <line
      x1="14"
      y1="10"
      x2="19"
      y2="4"
    />
    <polyline points="9 20 5 20 5 16" />
    <line
      x1="10"
      y1="14"
      x2="5"
      y2="20"
    />
  </svg>
</template>

<script setup>
defineProps({
  name: {
    type: String,
    required: true,
  },
});
</script>
