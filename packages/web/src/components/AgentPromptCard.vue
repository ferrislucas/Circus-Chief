<template>
  <section
    v-if="prompt"
    ref="card"
    class="agent-prompt-card card"
    :class="`agent-prompt-card--${prompt.kind}`"
    aria-live="polite"
    :aria-busy="submitting"
  >
    <header class="prompt-header">
      <span class="prompt-status">Needs input</span>
      <span v-if="subagentLabel" class="prompt-origin" :title="`Raised by subagent ${prompt.agentId}`">Subagent · {{ subagentLabel }}</span>
      <p class="prompt-context">{{ prompt.kind === 'question' ? 'The agent is waiting for your guidance.' : 'The agent needs approval to continue.' }}</p>
    </header>

    <template v-if="prompt.kind === 'question'">
      <div
        v-for="(question, index) in prompt.payload.questions"
        :key="question.question"
        class="question-block"
      >
        <div class="question-heading">
          <span v-if="question.header" class="question-chip">{{ question.header }}</span>
          <h3>{{ question.question }}</h3>
        </div>

        <div class="option-list" :aria-label="question.question">
          <label
            v-for="(option, optionIndex) in question.options"
            :key="option.label"
            class="option-card"
            :class="{ 'is-selected': isOptionSelected(question, option.label), 'is-focused': isOptionFocused(index, option.label) }"
            @focusin="setFocusedOption(index, option.label)"
          >
            <input
              :ref="(element) => setFirstAnswerControl(index, optionIndex, element)"
              v-model="answers[question.question]"
              class="option-control"
              :type="question.multiSelect ? 'checkbox' : 'radio'"
              :name="`question-${index}`"
              :value="option.label"
              :disabled="submitting"
              @change="clearOther(question)"
            >
            <span class="option-indicator" aria-hidden="true" />
            <span class="option-copy">
              <strong>{{ option.label }}</strong>
              <small v-if="option.description">{{ option.description }}</small>
            </span>
            <span v-if="isOptionSelected(question, option.label)" class="selected-mark" aria-hidden="true">Selected</span>
            <div v-if="option.preview && shouldShowPreview(index, question, option)" class="option-preview">
              <span>Preview</span>
              <MarkdownViewer :content="option.preview" />
            </div>
          </label>

          <label
            class="option-card option-card--other"
            :class="{ 'is-selected': Boolean(other[question.question]?.trim()), 'is-focused': isOptionFocused(index, 'other') }"
            @focusin="setFocusedOption(index, 'other')"
          >
            <span class="option-indicator option-indicator--other" aria-hidden="true">+</span>
            <span class="option-copy"><strong>Other</strong><small>Give the agent your own answer.</small></span>
            <input
              v-model="other[question.question]"
              @input="selectOther(question)"
              class="form-input other-input"
              placeholder="Other…"
              :disabled="submitting"
            >
          </label>
        </div>

        <label class="additional-response question-notes">
          <span>Note <em>optional</em></span>
          <textarea v-model="notes[question.question]" class="form-input form-textarea question-note" :disabled="submitting" placeholder="Why this choice?" />
        </label>
      </div>

      <footer class="prompt-actions">
        <span v-if="submitting" class="pending-state" role="status">Sending response…</span>
        <button class="btn prompt-primary-action" :disabled="submitting || !canSubmit" @click="submitAnswers">Send answers</button>
        <button class="btn-link prompt-quiet-action" :disabled="submitting" @click="respond({ action: 'cancel' })">Skip and let the agent decide</button>
      </footer>
    </template>

    <template v-else>
      <div class="permission-intro">
        <h3>{{ prompt.payload.title || prompt.payload.displayName || prompt.payload.toolName }}</h3>
        <p v-if="prompt.payload.description">{{ prompt.payload.description }}</p>
      </div>
      <section class="permission-evidence" aria-label="Proposed change">
        <div class="evidence-heading"><span>Proposed change</span><code>{{ prompt.payload.toolName }}</code></div>
        <DiffViewer v-if="isFileMutation" :files="permissionDiffFiles" :expand-all="true" />
        <pre v-else>{{ JSON.stringify(prompt.payload.input, null, 2) }}</pre>
      </section>
      <footer class="prompt-actions permission-actions">
        <span v-if="submitting" class="pending-state" role="status">Saving decision…</span>
        <button ref="allowOnce" class="btn prompt-primary-action" :disabled="submitting" @click="respond({ action: 'allow' })">Allow once</button>
        <div v-if="prompt.payload.suggestions?.length" class="always-allow">
          <button class="btn btn-secondary" :disabled="submitting" @click="respond({ action: 'always_allow', destination })">Always allow</button>
          <label class="permission-scope">Scope
            <select v-model="destination" :disabled="submitting"><option value="session">This session</option><option value="projectSettings">This project</option></select>
          </label>
        </div>
        <button class="btn-link deny-action" :disabled="submitting" @click="showDenyReason = !showDenyReason">{{ showDenyReason ? 'Cancel denial' : 'Deny' }}</button>
        <label v-if="showDenyReason" class="deny-reason">
          <span>Reason <em>optional</em></span>
          <input v-model="reason" class="form-input" :disabled="submitting" placeholder="Explain why this should not run" @keyup.enter="respond({ action: 'deny', reason })">
          <button class="btn btn-outline-danger" :disabled="submitting" @click="respond({ action: 'deny', reason })">Confirm deny</button>
        </label>
      </footer>
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
const answers = ref({});
const other = ref({});
const notes = ref({});
const reason = ref('');
const destination = ref('session');
const focusedOption = ref({ question: 0, label: null });
const showDenyReason = ref(false);
const card = ref(null);
const allowOnce = ref(null);
const firstAnswerControls = ref([]);

function setFirstAnswerControl(questionIndex, optionIndex, element) {
  if (optionIndex === 0 && element) firstAnswerControls.value[questionIndex] = element;
}

watch(() => props.prompt?.id, async () => {
  answers.value = {};
  for (const question of props.prompt?.payload.questions || []) if (question.multiSelect) answers.value[question.question] = [];
  other.value = {}; notes.value = {}; reason.value = ''; destination.value = 'session'; showDenyReason.value = false;
  focusedOption.value = { question: 0, label: null }; firstAnswerControls.value = [];
  await nextTick();
  if (typeof card.value?.scrollIntoView === 'function') card.value.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const target = props.prompt?.kind === 'question' ? firstAnswerControls.value[0] : allowOnce.value;
  target?.focus?.();
}, { immediate: true });

function setFocusedOption(question, label) { focusedOption.value = { question, label }; }
function isOptionFocused(question, label) { return focusedOption.value.question === question && focusedOption.value.label === label; }
function isOptionSelected(question, label) {
  const selected = answers.value[question.question];
  return Array.isArray(selected) ? selected.includes(label) : selected === label;
}
function shouldShowPreview(index, question, option) { return isOptionSelected(question, option.label) || isOptionFocused(index, option.label); }
function hasAnswer(question) {
  const selected = answers.value[question.question];
  return Boolean(other.value[question.question]?.trim() || (Array.isArray(selected) ? selected.length : selected));
}
const canSubmit = computed(() => Boolean(props.prompt?.payload.questions?.every(hasAnswer)));
// Main-agent prompts (no agentId) render no origin metadata. Subagent
// prompts get a short, visually stable label; the full id stays available
// via the `title` attribute so it's never lost, just not spelled out inline
// where a long identifier could overflow the card.
const subagentLabel = computed(() => {
  const id = props.prompt?.agentId;
  if (!id) return null;
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
});
const isFileMutation = computed(() => ['Edit', 'Write'].includes(props.prompt?.payload.toolName));
const permissionDiffFiles = computed(() => {
  const input = props.prompt?.payload.input || {};
  const path = input.file_path || input.path || input.filename || 'pending change';
  const before = input.old_string || ''; const after = input.new_string || input.content || '';
  const beforeLines = before === '' ? [] : before.split('\n'); const afterLines = after === '' ? [] : after.split('\n');
  return [{ displayPath: path, isNew: props.prompt?.payload.toolName === 'Write', isDeleted: false, isRenamed: false, additions: afterLines.length, deletions: beforeLines.length, hunks: [{ oldStart: 1, oldLines: beforeLines.length, newStart: 1, newLines: afterLines.length, lines: [...beforeLines.map((content, index) => ({ type: 'remove', content, oldLineNumber: index + 1 })), ...afterLines.map((content, index) => ({ type: 'add', content, newLineNumber: index + 1 }))] }] }];
});
function respond(response) { emit('respond', response); }
function selectedAnswer(question) {
  const selected = answers.value[question.question];
  return Array.isArray(selected) ? selected : selected ? [selected] : [];
}
function collectAnswers() { return Object.fromEntries(props.prompt.payload.questions.map((question) => [question.question, selectedAnswer(question)])); }
function collectCustomAnswers() {
  return Object.fromEntries(props.prompt.payload.questions.flatMap((question) => {
    const custom = other.value[question.question];
    return custom?.trim() ? [[question.question, custom]] : [];
  }));
}
function collectAnnotations() {
  return Object.fromEntries(props.prompt.payload.questions.flatMap((question) => {
    const note = notes.value[question.question];
    const selected = answers.value[question.question]; const labels = Array.isArray(selected) ? selected : [selected];
    const previews = question.options.filter((option) => labels.includes(option.label) && option.preview).map((option) => option.preview);
    const annotation = { ...(note?.trim() ? { notes: note } : {}), ...(previews.length ? { preview: previews.join('\n\n') } : {}) };
    return Object.keys(annotation).length ? [[question.question, annotation]] : [];
  }));
}
function submitAnswers() { if (!canSubmit.value) return; const annotations = collectAnnotations(); const customAnswers = collectCustomAnswers(); respond({ action: 'answer', answers: collectAnswers(), ...(Object.keys(customAnswers).length ? { customAnswers } : {}), ...(Object.keys(annotations).length ? { annotations } : {}) }); }
function chooseOption(index) {
  const question = props.prompt?.payload.questions?.[focusedOption.value.question]; const option = question?.options?.[index];
  if (!question || !option || props.submitting) return;
  other.value[question.question] = '';
  if (question.multiSelect) { const selected = answers.value[question.question]; answers.value[question.question] = selected.includes(option.label) ? selected.filter((label) => label !== option.label) : [...selected, option.label]; } else answers.value[question.question] = option.label;
}
function selectOther(question) { answers.value[question.question] = question.multiSelect ? [] : ''; }
function clearOther(question) { other.value[question.question] = ''; }
// Radios and checkboxes are inputs, but cannot receive typed text. Treating
// them as typing targets prevents the prompt shortcuts from working on the
// control we deliberately autofocus for native keyboard/screen-reader use.
function isTypingTarget(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ['TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  if (target.tagName !== 'INPUT') return false;
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(target.type);
}
// `useKeyboardShortcuts` registers a single document-level listener shared by
// every mounted instance (main view, SessionChatOverlay, ...). Without this,
// a shortcut aimed at one card — or at an unrelated overlay/modal elsewhere
// on the page — would also fire every OTHER mounted card's handler. Scoping
// on "is focus currently inside this card" keeps each instance's shortcuts
// acting only on itself, and only while the user is actually interacting
// with it.
function isFocusWithinCard() { return Boolean(card.value && document.activeElement && card.value.contains(document.activeElement)); }
function promptShortcut(event, action) { if (!props.prompt || props.submitting || isTypingTarget(event) || !isFocusWithinCard()) return; action(event); }
useKeyboardShortcuts({
  '1': (event) => promptShortcut(event, () => chooseOption(0)), '2': (event) => promptShortcut(event, () => chooseOption(1)), '3': (event) => promptShortcut(event, () => chooseOption(2)), '4': (event) => promptShortcut(event, () => chooseOption(3)),
  enter: (event) => promptShortcut(event, () => { if (props.prompt.kind === 'question' && canSubmit.value) { event.preventDefault(); submitAnswers(); } }),
  // Question-prompt Escape stays a genuine, non-destructive skip: the agent
  // proceeds on its own judgment, nothing is lost. A permission prompt is
  // different — denying a tool call is a one-way decision the agent acts on
  // immediately, so Escape only *reveals* the same deny-reason affordance
  // the "Deny" link opens; only that panel's explicit "Confirm deny" (or
  // Enter in the reason field) actually emits the deny. A second Escape
  // while the panel is already open still does not deny — it is not an
  // "are you sure" confirmation gesture here, just the same reveal.
  escape: (event) => promptShortcut(event, () => {
    event.preventDefault();
    if (props.prompt.kind === 'question') { respond({ action: 'cancel' }); return; }
    showDenyReason.value = true;
  }),
});
</script>

<style scoped>
.agent-prompt-card { --prompt-amber: #d29922; --prompt-amber-soft: rgba(210, 153, 34, .13); position: relative; margin-top: .75rem; padding: 1.25rem; border-color: rgba(210, 153, 34, .46); box-shadow: 0 12px 32px rgba(0, 0, 0, .22), inset 3px 0 var(--prompt-amber); }
.prompt-header { display: flex; align-items: baseline; gap: .75rem; margin-bottom: 1.15rem; }
.prompt-status { color: #f2c462; font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.prompt-status::before { content: '◆'; margin-right: .45rem; font-size: .58rem; }
.prompt-origin { flex: 0 1 auto; min-width: 0; max-width: 14rem; padding: .1rem .45rem; overflow: hidden; border: 1px solid var(--color-border); border-radius: 999px; color: var(--color-text-soft); font-size: .68rem; font-weight: 600; letter-spacing: .02em; text-overflow: ellipsis; white-space: nowrap; }
.prompt-context, .permission-intro p { color: var(--color-text-soft); font-size: .85rem; }
.question-block + .question-block { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--color-border); }
.question-heading { display: flex; align-items: flex-start; gap: .65rem; margin-bottom: .75rem; }
.question-heading h3, .permission-intro h3 { color: var(--color-text); font-size: 1rem; line-height: 1.45; }
.question-chip { flex: 0 0 auto; padding: .14rem .42rem; border: 1px solid rgba(210, 153, 34, .38); border-radius: 999px; color: #f2c462; font-size: .68rem; font-weight: 600; text-transform: uppercase; }
.option-list { display: grid; gap: .5rem; }
.option-card { display: grid; grid-template-columns: 1.15rem minmax(0, 1fr) auto; align-items: start; gap: .7rem; min-height: 3.2rem; padding: .7rem .8rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-background); cursor: pointer; transition: border-color .16s ease, background .16s ease, transform .16s ease; }
.option-card:hover { border-color: rgba(210, 153, 34, .55); background: rgba(210, 153, 34, .06); }
.option-card.is-selected, .option-card.is-focused { border-color: var(--prompt-amber); background: var(--prompt-amber-soft); }
.option-card.is-focused { box-shadow: 0 0 0 3px rgba(210, 153, 34, .22); }
.option-control { position: absolute; opacity: 0; pointer-events: none; }
.option-indicator { width: 1.1rem; height: 1.1rem; margin-top: .12rem; border: 1px solid #6e7681; border-radius: 50%; background: var(--color-background-soft); }
.option-control[type='checkbox'] + .option-indicator { border-radius: 3px; }
.option-control:checked + .option-indicator { border-color: var(--prompt-amber); background: var(--prompt-amber); box-shadow: inset 0 0 0 3px var(--color-background); }
.option-copy { min-width: 0; }.option-copy strong { display: block; color: var(--color-text); font-size: .9rem; }.option-copy small { display: block; margin-top: .1rem; color: var(--color-text-soft); font-size: .8rem; line-height: 1.35; }
.selected-mark { color: #f2c462; font-size: .68rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.option-preview { grid-column: 2 / -1; margin-top: .15rem; padding: .65rem .75rem; border-left: 2px solid var(--prompt-amber); background: rgba(0, 0, 0, .18); color: var(--color-text-soft); font-size: .8rem; overflow: hidden; }.option-preview > span { display: block; margin-bottom: .3rem; color: #f2c462; font-size: .67rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
.option-card--other { grid-template-columns: 1.15rem minmax(0, 1fr); }.option-indicator--other { display: grid; place-items: center; color: var(--color-text-soft); font-weight: 700; }.other-input { grid-column: 2; margin-top: .15rem; }.additional-response { display: block; margin-top: 1rem; }.additional-response > span, .deny-reason > span { display: block; margin-bottom: .35rem; color: var(--color-text-soft); font-size: .78rem; }.additional-response em, .deny-reason em { font-style: normal; opacity: .75; }
.permission-intro { margin-bottom: 1rem; }.permission-intro h3 { margin-bottom: .3rem; }.permission-evidence { overflow: hidden; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-background); }.evidence-heading { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .55rem .75rem; border-bottom: 1px solid var(--color-border); color: var(--color-text-soft); font-size: .72rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }.evidence-heading code { color: #f2c462; font-size: .68rem; text-transform: none; }.permission-evidence pre { max-height: 15rem; margin: 0; border: 0; border-radius: 0; background: transparent; }
.prompt-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem .7rem; margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--color-border); }.prompt-actions .btn { min-height: 2.75rem; }.prompt-primary-action { border-color: var(--prompt-amber); background: var(--prompt-amber); color: #15110a; font-weight: 700; }.prompt-primary-action:hover:not(:disabled) { background: #e3ad32; }.prompt-quiet-action, .deny-action { padding: .5rem .25rem; color: var(--color-text-soft); font-size: .82rem; }.deny-action { color: #ff9b95; }.always-allow { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; }.permission-scope { display: inline-flex; align-items: center; gap: .35rem; color: var(--color-text-soft); font-size: .75rem; }.permission-scope select { min-height: 2.4rem; padding: .35rem .5rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-background); color: var(--color-text); }.deny-reason { display: grid; grid-template-columns: minmax(12rem, 1fr) auto; gap: .45rem .65rem; flex-basis: 100%; margin-top: .2rem; }.deny-reason > span { grid-column: 1 / -1; margin: 0; }.deny-reason .btn { min-height: 2.5rem; }.pending-state { flex-basis: 100%; color: #f2c462; font-size: .78rem; }.agent-prompt-card :is(button, input, textarea, select):focus-visible { outline: 2px solid #f2c462; outline-offset: 2px; }.agent-prompt-card :is(button, input, textarea, select):disabled { cursor: not-allowed; opacity: .55; }
@media (max-width: 600px) { .agent-prompt-card { padding: 1rem; }.prompt-header { display: block; }.prompt-context { margin-top: .2rem; }.question-heading { display: block; }.question-chip { display: inline-block; margin-bottom: .35rem; }.option-card { grid-template-columns: 1.15rem minmax(0, 1fr); }.selected-mark { grid-column: 2; }.option-preview { grid-column: 2; }.prompt-actions { align-items: stretch; }.prompt-primary-action { flex: 1 1 100%; }.always-allow { flex: 1 1 100%; }.always-allow .btn { flex: 1; }.permission-scope { flex: 1; justify-content: space-between; }.permission-scope select { flex: 1; }.deny-reason { grid-template-columns: 1fr; }.deny-reason .btn { width: 100%; } }
</style>
