<template>
  <section class="git-status-summary" :class="{ 'is-muted': !hasAttention }">
    <div class="git-status-copy">
      <div class="git-status-title">{{ title }}</div>
      <div class="git-status-counts">{{ operationText || summaryText }}</div>
      <div v-if="branchMapping" class="git-status-branch">{{ branchMapping }}</div>
      <div v-if="unavailableReason" class="git-status-reason">{{ unavailableReason }}</div>
      <div v-if="lastCheckedText" class="git-status-checked">Last checked {{ lastCheckedText }}</div>
      <div v-if="error" class="git-status-error" role="alert">{{ errorMessage }} <button type="button" class="dismiss-error" @click="$emit('dismiss-error')">Dismiss</button></div>
    </div>
    <div class="git-status-actions">
      <button v-if="showPush" type="button" class="btn btn-secondary" :disabled="syncLocked || pushDisabled" :title="pushReason" @click="$emit('push')"><span v-if="operation === 'push'" class="loading-spinner" />{{ operation === 'push' ? 'Pushing…' : pushLabel }}</button>
      <button v-if="showPull" type="button" class="btn btn-secondary" :disabled="syncLocked || pullDisabled" :title="pullReason" @click="$emit('pull')"><span v-if="operation === 'pull'" class="loading-spinner" />{{ operation === 'pull' ? 'Pulling…' : pullLabel }}</button>
      <button type="button" class="btn btn-secondary refresh-origin-button" :disabled="syncLocked || loading" @click="$emit('refresh-origin')"><span v-if="loading" class="loading-spinner" />Refresh</button>
      <div v-if="disabledReasons" class="git-status-action-help">{{ disabledReasons }}</div>
    </div>
  </section>
</template>
<script setup>
import { computed } from 'vue';
const props = defineProps({ status:{type:Object,default:null}, summaryText:{type:String,default:'Git status unknown'}, loading:Boolean, operation:{type:String,default:null}, error:{type:[Object,String],default:null} });
defineEmits(['refresh-origin','push','pull','dismiss-error']);
const syncLocked = computed(() => Boolean(props.operation));
const hasBranch = computed(() => Boolean(props.status?.currentBranch));
const hasOrigin = computed(() => props.status?.hasOrigin === true);
const showPush = computed(() => hasBranch.value && hasOrigin.value);
const showPull = computed(() => showPush.value && props.status?.upstreamBranch?.startsWith('origin/'));
const fresh = computed(() => props.status?.fetched !== false && props.status?.syncStatus !== 'unknown');
const pushDisabled = computed(() => fresh.value && props.status?.syncStatus !== 'unpublished' && !(props.status?.aheadCount > 0));
const pullDisabled = computed(() => fresh.value && !(props.status?.behindCount > 0));
const pushReason = computed(() => pushDisabled.value ? 'Nothing to push' : props.status?.syncStatus === 'unpublished' ? 'Publish this branch to origin' : 'Push commits to origin');
const pullReason = computed(() => pullDisabled.value ? 'Already up to date' : 'Pull from origin');
const disabledReasons = computed(() => [pushDisabled.value && showPush.value ? pushReason.value : null, pullDisabled.value && showPull.value ? pullReason.value : null].filter(Boolean).join(' · '));
const unavailableReason = computed(() => { if (!props.status) return null; if (!hasBranch.value) return 'HEAD is detached — checkout a branch to push or pull.'; if (!hasOrigin.value) return 'No origin remote configured — push/pull unavailable.'; if (!showPull.value) return 'Branch has no origin upstream. Publish it to enable pull.'; return null; });
const hasAttention = computed(() => Boolean(props.error || props.status?.aheadCount || props.status?.behindCount || props.status?.syncStatus === 'unpublished' || props.status?.syncStatus === 'diverged'));
const title = computed(() => hasAttention.value ? 'Git attention' : 'Git status');
const branchMapping = computed(() => !hasBranch.value ? null : props.status?.upstreamBranch ? `${props.status.currentBranch} → ${props.status.upstreamBranch}` : `${props.status.currentBranch} has no upstream`);
const pushLabel = computed(() => props.status?.syncStatus === 'unpublished' ? `Publish${props.status?.aheadCount ? ` (${props.status.aheadCount})` : ''}` : `Push${props.status?.aheadCount ? ` (${props.status.aheadCount})` : ''}`);
const pullLabel = computed(() => `Pull${props.status?.behindCount ? ` (${props.status.behindCount})` : ''}`);
const operationText = computed(() => props.operation === 'push' ? `Pushing to ${props.status?.upstreamBranch || `origin/${props.status?.currentBranch || ''}`}…` : props.operation === 'pull' ? `Pulling ${props.status?.upstreamBranch || 'origin'}…` : null);
const lastCheckedText = computed(() => props.status?.lastCheckedAt ? new Date(props.status.lastCheckedAt).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : null);
const errorMessage = computed(() => typeof props.error === 'string' ? props.error : props.error?.message || 'Git status lookup failed');
</script>
<style scoped>
.git-status-summary{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:.75rem;padding:.875rem;border:1px solid rgba(245,158,11,.45);border-radius:6px;background:rgba(245,158,11,.1)}.git-status-summary.is-muted{border-color:var(--color-border);background:var(--color-bg-soft,rgba(255,255,255,.04))}.git-status-copy{min-width:0}.git-status-title{color:var(--color-text);font-size:.875rem;font-weight:600}.git-status-counts{margin-top:.25rem;color:var(--color-text);font-size:.8125rem}.git-status-branch,.git-status-checked,.git-status-reason,.git-status-action-help{margin-top:.25rem;color:var(--color-text-soft);font-size:.75rem;overflow-wrap:anywhere}.git-status-error{margin-top:.375rem;color:var(--color-error);font-size:.75rem}.dismiss-error{margin-left:.5rem;color:inherit;background:none;border:0;text-decoration:underline;cursor:pointer}.git-status-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.5rem;flex-shrink:0}.git-status-actions .btn{min-height:2.375rem;display:inline-flex;align-items:center;justify-content:center;gap:.375rem;white-space:nowrap}.git-status-action-help{width:100%}@media(max-width:768px){.git-status-summary{flex-direction:column}.git-status-actions{width:100%;justify-content:flex-start}.git-status-actions .btn{flex:1}}
</style>
