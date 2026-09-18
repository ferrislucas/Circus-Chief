<template>
  <Teleport to="body">
    <div v-if="isOpen" class="modal-backdrop" @click.self="cancel">
      <div ref="dialog" class="modal-content" role="dialog" aria-modal="true" aria-labelledby="pull-modal-title" aria-describedby="pull-modal-description" @keydown="trapFocus">
        <div class="modal-header">
          <h2 id="pull-modal-title" class="modal-title">Pull from origin</h2>
          <button ref="closeButton" class="close-btn" aria-label="Close modal" :disabled="loading" @click="cancel">&times;</button>
        </div>
        <div class="modal-body">
          <p id="pull-modal-description" class="confirm-message">Pull {{ upstream }} into {{ branch }}?</p>
          <p v-if="behindCount > 0" class="warning">{{ behindCount }} {{ behindCount === 1 ? 'commit' : 'commits' }} will be brought in.</p>
          <p v-if="localChangeCount > 0" class="warning">Your worktree has {{ localChangeCount }} uncommitted local {{ localChangeCount === 1 ? 'change' : 'changes' }}. Pull uses fast-forward-only and may fail until local work is committed, stashed, or reconciled.</p>
          <p v-else-if="aheadCount > 0" class="warning">Your branch has {{ aheadCount }} local commits ahead of {{ upstream }}. Pulling requires the histories to reconcile; fast-forward-only will report what is needed.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" :disabled="loading" @click="cancel">Cancel</button>
          <button class="btn btn-primary" :disabled="loading" @click="$emit('confirm')"><span v-if="loading" class="loading-spinner" />{{ loading ? 'Pulling…' : 'Pull' }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
const props = defineProps({ isOpen: Boolean, loading: Boolean, branch: { type: String, default: '' }, upstream: { type: String, default: 'origin' }, behindCount: { type: Number, default: 0 }, aheadCount: { type: Number, default: 0 }, localChangeCount: { type: Number, default: 0 } });
const emit = defineEmits(['confirm', 'cancel']);
const dialog = ref(null);
const closeButton = ref(null);
let previouslyFocused = null;
function cancel() { if (!props.loading) emit('cancel'); }
function escape(event) { if (event.key === 'Escape' && props.isOpen) cancel(); }
function focusableElements() {
  return [...(dialog.value?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
    .filter((element) => !element.hasAttribute('disabled'));
}
function trapFocus(event) {
  if (event.key !== 'Tab') return;
  const elements = focusableElements();
  if (!elements.length) return;
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
watch(() => props.isOpen, async (isOpen, wasOpen) => {
  if (isOpen && !wasOpen) {
    previouslyFocused = document.activeElement;
    await nextTick();
    closeButton.value?.focus();
  } else if (!isOpen && wasOpen) {
    await nextTick();
    previouslyFocused?.focus?.();
    previouslyFocused = null;
  }
});
onMounted(() => document.addEventListener('keydown', escape));
onUnmounted(() => {
  document.removeEventListener('keydown', escape);
  if (props.isOpen) previouslyFocused?.focus?.();
});
</script>
<style scoped>
.modal-backdrop { position:fixed; inset:0; z-index:1000; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.7); }
.modal-content { width:min(450px, calc(100% - 2rem)); overflow:hidden; border:1px solid var(--color-border); border-radius:.5rem; background:var(--color-background-secondary,#1f2937); }
.modal-header,.modal-footer { display:flex; align-items:center; padding:1rem 1.5rem; border-bottom:1px solid var(--color-border); }.modal-footer { justify-content:flex-end; gap:.75rem; border-top:1px solid var(--color-border); border-bottom:0; }.modal-title{margin:0;font-size:1.125rem}.close-btn{margin-left:auto;background:none;border:0;color:var(--color-text);font-size:1.5rem}.modal-body{padding:1.5rem}.confirm-message,.warning{margin:0;color:var(--color-text);line-height:1.5}.warning{margin-top:1rem;color:var(--color-text-soft)}
</style>
