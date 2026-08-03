<template>
  <section
    v-if="prompt"
    ref="card"
    class="mt-3 border border-amber-500/40 bg-amber-950/20 p-4 text-sm shadow-lg"
    aria-live="polite"
  >
    <div class="mb-3 flex items-center gap-2 text-amber-300">
      <span class="text-lg">◆</span><strong>{{ prompt.kind === 'question' ? 'Agent needs your input' : 'Permission required' }}</strong>
    </div>
    <template v-if="prompt.kind === 'question'">
      <div
        v-for="(question, index) in prompt.payload.questions"
        :key="question.question"
        class="mb-4 border-l-2 border-amber-500/50 pl-3"
        @focusin="focusedQuestion = index"
      >
        <span
          v-if="question.header"
          class="rounded bg-amber-400/15 px-2 py-0.5 text-xs text-amber-200"
        >{{ question.header }}</span>
        <p class="my-2 text-gray-100">
          {{ question.question }}
        </p>
        <label
          v-for="option in question.options"
          :key="option.label"
          class="mb-1 flex cursor-pointer gap-2 rounded p-2 hover:bg-amber-400/10"
        >
          <input
            v-model="answers[question.question]"
            :type="question.multiSelect ? 'checkbox' : 'radio'"
            :name="`question-${index}`"
            :value="option.label"
          >
          <span><b>{{ option.label }}</b><small class="block text-gray-400">{{ option.description }}</small></span>
        </label>
        <details
          v-for="option in question.options.filter((item) => item.preview)"
          :key="`${option.label}-preview`"
          class="mt-1 text-gray-300"
        >
          <summary class="cursor-pointer text-amber-200">
            Preview: {{ option.label }}
          </summary>
          <MarkdownViewer :content="option.preview" />
        </details>
        <input
          v-model="other[question.question]"
          class="mt-1 w-full border border-gray-600 bg-gray-900 p-2 text-white"
          placeholder="Other…"
        >
      </div>
      <textarea
        v-model="freeResponse"
        class="mb-3 w-full border border-gray-600 bg-gray-900 p-2 text-white"
        placeholder="Additional response (optional)"
      />
      <button
        class="mr-2 bg-amber-500 px-3 py-2 font-medium text-black disabled:opacity-50"
        :disabled="submitting || !canSubmit"
        @click="submitAnswers"
      >
        Send answers
      </button>
      <button
        class="px-3 py-2 text-amber-200"
        :disabled="submitting"
        @click="respond({ action: 'skip' })"
      >
        Skip
      </button>
    </template>
    <template v-else>
      <h3 class="text-base text-white">
        {{ prompt.payload.title || prompt.payload.displayName || prompt.payload.toolName }}
      </h3>
      <p class="my-2 text-gray-300">
        {{ prompt.payload.description }}
      </p>
      <DiffViewer
        v-if="isFileMutation"
        :files="permissionDiffFiles"
        :expand-all="true"
      />
      <pre
        v-else
        class="max-h-48 overflow-auto bg-black/40 p-3 text-xs text-gray-200"
      >{{ JSON.stringify(prompt.payload.input, null, 2) }}</pre>
      <input
        v-model="reason"
        class="my-3 w-full border border-gray-600 bg-gray-900 p-2 text-white"
        placeholder="Reason when denying (optional)"
      >
      <button
        class="mr-2 bg-amber-500 px-3 py-2 font-medium text-black"
        :disabled="submitting"
        @click="respond({ action: 'allow' })"
      >
        Allow once
      </button>
      <label
        v-if="prompt.payload.suggestions?.length"
        class="mr-2 text-xs text-gray-300"
      >
        Apply to
        <select
          v-model="destination"
          class="ml-1 border border-gray-600 bg-gray-900 p-1 text-white"
          :disabled="submitting"
        >
          <option value="session">this session</option>
          <option value="projectSettings">this project</option>
        </select>
      </label>
      <button
        v-if="prompt.payload.suggestions?.length"
        class="mr-2 border border-amber-400 px-3 py-2 text-amber-100"
        :disabled="submitting"
        @click="respond({ action: 'always', destination })"
      >
        Always allow
      </button>
      <button
        class="px-3 py-2 text-amber-200"
        :disabled="submitting"
        @click="respond({ action: 'deny', reason })"
      >
        Deny
      </button>
    </template>
  </section>
</template>
<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useKeyboardShortcuts } from '../composables/useKeyboardShortcuts.js';
import DiffViewer from './DiffViewer.vue';
import MarkdownViewer from './MarkdownViewer.vue';
const props = defineProps({ prompt: { type: Object, default: null }, submitting: Boolean });
const emit = defineEmits(['respond']);
const answers = ref({}); const other = ref({}); const freeResponse = ref(''); const reason = ref(''); const destination = ref('session'); const focusedQuestion = ref(0); const card = ref(null);
watch(() => props.prompt?.id, async () => {
  answers.value = {};
  for (const question of props.prompt?.payload.questions || []) if (question.multiSelect) answers.value[question.question] = [];
  other.value = {}; freeResponse.value = ''; reason.value = ''; destination.value = 'session'; focusedQuestion.value = 0;
  await nextTick();
  if (typeof card.value?.scrollIntoView === 'function') card.value.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}, { immediate: true });
function hasAnswer(question) {
  const selected = answers.value[question.question];
  return Boolean(other.value[question.question]?.trim() || (Array.isArray(selected) ? selected.length : selected));
}
const canSubmit = computed(() => Boolean(props.prompt?.payload.questions?.every(hasAnswer)));
const isFileMutation = computed(() => ['Edit', 'Write'].includes(props.prompt?.payload.toolName));
const permissionDiffFiles = computed(() => {
  const input = props.prompt?.payload.input || {};
  const path = input.file_path || input.path || input.filename || 'pending change';
  const before = input.old_string || '';
  const after = input.new_string || input.content || '';
  const beforeLines = before === '' ? [] : before.split('\n');
  const afterLines = after === '' ? [] : after.split('\n');
  return [{
    displayPath: path, isNew: props.prompt?.payload.toolName === 'Write', isDeleted: false, isRenamed: false,
    additions: afterLines.length, deletions: beforeLines.length,
    hunks: [{ oldStart: 1, oldLines: beforeLines.length, newStart: 1, newLines: afterLines.length,
      lines: [...beforeLines.map((content, index) => ({ type: 'remove', content, oldLineNumber: index + 1 })), ...afterLines.map((content, index) => ({ type: 'add', content, newLineNumber: index + 1 }))] }],
  }];
});
function respond(response) { emit('respond', response); }
function collectAnswers() {
  return Object.fromEntries(props.prompt.payload.questions.map((question) => [
    question.question,
    other.value[question.question]?.trim() || (Array.isArray(answers.value[question.question]) ? answers.value[question.question].join(', ') : answers.value[question.question]),
  ]));
}
function collectAnnotations() {
  return Object.fromEntries(props.prompt.payload.questions.flatMap((question) => {
    const selected = answers.value[question.question];
    const labels = Array.isArray(selected) ? selected : [selected];
    const previews = question.options.filter((option) => labels.includes(option.label) && option.preview).map((option) => option.preview);
    const note = other.value[question.question]?.trim();
    if (!note && previews.length === 0) return [];
    return [[question.question, { ...(note ? { note } : {}), ...(previews.length ? { preview: previews.join('\n\n') } : {}) }]];
  }));
}
function submitAnswers() {
  if (!canSubmit.value) return;
  const annotations = collectAnnotations();
  respond({ action: 'answer', answers: collectAnswers(), ...(Object.keys(annotations).length ? { annotations } : {}), ...(freeResponse.value.trim() ? { response: freeResponse.value.trim() } : {}) });
}
function chooseOption(index) {
  const question = props.prompt?.payload.questions?.[focusedQuestion.value]; const option = question?.options?.[index];
  if (!question || !option || props.submitting) return;
  if (question.multiSelect) {
    const selected = answers.value[question.question];
    answers.value[question.question] = selected.includes(option.label) ? selected.filter((label) => label !== option.label) : [...selected, option.label];
  } else answers.value[question.question] = option.label;
}
function isTypingTarget(event) {
  const target = event.target;
  return target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
}
function promptShortcut(event, action) {
  if (!props.prompt || props.submitting || isTypingTarget(event)) return;
  action(event);
}
useKeyboardShortcuts({
  '1': (event) => promptShortcut(event, () => chooseOption(0)), '2': (event) => promptShortcut(event, () => chooseOption(1)), '3': (event) => promptShortcut(event, () => chooseOption(2)), '4': (event) => promptShortcut(event, () => chooseOption(3)),
  enter: (event) => promptShortcut(event, () => { if (props.prompt.kind === 'question' && canSubmit.value) { event.preventDefault(); submitAnswers(); } }),
  escape: (event) => promptShortcut(event, () => { event.preventDefault(); respond(props.prompt.kind === 'question' ? { action: 'skip' } : { action: 'deny', reason: reason.value }); }),
});
</script>
