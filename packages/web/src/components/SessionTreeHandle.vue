<template>
  <div
    class="session-tree-handle"
    tabindex="0"
    role="button"
    aria-label="Open session tree"
    data-testid="session-tree-handle"
    @click="handleOpen"
    @keydown.enter.prevent="handleOpen"
    @keydown.space.prevent="handleOpen"
  >
    <svg
      class="handle-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <!-- Tree/hierarchy icon -->
      <path
        d="M4 2v4h3v2H4v4h3M10 4h3M10 8h3M10 12h3"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </div>
</template>

<script setup>
const emit = defineEmits(['open']);

function handleOpen() {
  emit('open');
}
</script>

<style scoped>
.session-tree-handle {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(55, 65, 81, 0.8);
  border-radius: 8px 0 0 8px;
  cursor: pointer;
  z-index: 900;
  transition: background-color 0.2s ease, transform 0.2s ease;
  min-width: 44px;
  min-height: 44px;
}

.session-tree-handle:hover {
  background: rgba(8, 145, 178, 0.9);
  transform: translateY(-50%) translateX(-4px);
}

.session-tree-handle:focus-visible {
  outline: 2px solid var(--color-primary, #06b6d4);
  outline-offset: 2px;
}

.handle-icon {
  color: var(--color-text-soft, #9ca3af);
  transition: color 0.2s ease;
}

.session-tree-handle:hover .handle-icon {
  color: #fff;
}
</style>
