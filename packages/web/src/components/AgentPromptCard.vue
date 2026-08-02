<template>
  <section v-if="prompt" ref="card" class="mt-3 border border-amber-500/40 bg-amber-950/20 p-4 text-sm shadow-lg" aria-live="polite">
    <div class="mb-3 flex items-center gap-2 text-amber-300"><span class="text-lg">◆</span><strong>{{ prompt.kind === 'question' ? 'Agent needs your input' : 'Permission required' }}</strong></div>
    <template v-if="prompt.kind === 'question'">
      <div v-for="(question, index) in prompt.payload.questions" :key="question.question" class="mb-4 border-l-2 border-amber-500/50 pl-3">
        <span v-if="question.header" class="rounded bg-amber-400/15 px-2 py-0.5 text-xs text-amber-200">{{ question.header }}</span>
        <p class="my-2 text-gray-100">{{ question.question }}</p>
        <label v-for="option in question.options" :key="option.label" class="mb-1 flex cursor-pointer gap-2 rounded p-2 hover:bg-amber-400/10">
          <input :type="question.multiSelect ? 'checkbox' : 'radio'" :name="`question-${index}`" :value="option.label" v-model="answers[question.question]" />
          <span><b>{{ option.label }}</b><small class="block text-gray-400">{{ option.description }}</small></span>
        </label>
        <input v-model="other[question.question]" class="mt-1 w-full border border-gray-600 bg-gray-900 p-2 text-white" placeholder="Other…" />
      </div>
      <textarea v-model="freeResponse" class="mb-3 w-full border border-gray-600 bg-gray-900 p-2 text-white" placeholder="Additional response (optional)" />
      <button class="mr-2 bg-amber-500 px-3 py-2 font-medium text-black disabled:opacity-50" :disabled="submitting || !canSubmit" @click="answer">Send answers</button>
      <button class="px-3 py-2 text-amber-200" :disabled="submitting" @click="respond({ action: 'skip' })">Skip</button>
    </template>
    <template v-else>
      <h3 class="text-base text-white">{{ prompt.payload.title || prompt.payload.displayName || prompt.payload.toolName }}</h3>
      <p class="my-2 text-gray-300">{{ prompt.payload.description }}</p>
      <pre class="max-h-48 overflow-auto bg-black/40 p-3 text-xs text-gray-200">{{ JSON.stringify(prompt.payload.input, null, 2) }}</pre>
      <input v-model="reason" class="my-3 w-full border border-gray-600 bg-gray-900 p-2 text-white" placeholder="Reason when denying (optional)" />
      <button class="mr-2 bg-amber-500 px-3 py-2 font-medium text-black" :disabled="submitting" @click="respond({ action: 'allow' })">Allow once</button>
      <button v-if="prompt.payload.suggestions?.length" class="mr-2 border border-amber-400 px-3 py-2 text-amber-100" :disabled="submitting" @click="respond({ action: 'always' })">Always allow</button>
      <button class="px-3 py-2 text-amber-200" :disabled="submitting" @click="respond({ action: 'deny', reason })">Deny</button>
    </template>
  </section>
</template>
<script setup>
import { computed, nextTick, ref, watch } from 'vue';
const props = defineProps({ prompt: { type: Object, default: null }, submitting: Boolean });
const emit = defineEmits(['respond']);
const answers = ref({}); const other = ref({}); const freeResponse = ref(''); const reason = ref(''); const card = ref(null);
watch(() => props.prompt?.id, async () => { answers.value = {}; other.value = {}; freeResponse.value = ''; reason.value = ''; await nextTick(); card.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
const canSubmit = computed(() => freeResponse.value.trim() || props.prompt?.payload.questions.every((q) => (other.value[q.question] || (Array.isArray(answers.value[q.question]) ? answers.value[q.question].length : answers.value[q.question]))));
function respond(response) { emit('respond', response); }
function answer() { const value = {}; for (const q of props.prompt.payload.questions) value[q.question] = other.value[q.question] || (Array.isArray(answers.value[q.question]) ? answers.value[q.question].join(', ') : answers.value[q.question]); respond({ action: 'answer', answers: value, ...(freeResponse.value.trim() ? { response: freeResponse.value.trim() } : {}) }); }
</script>
