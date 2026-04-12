<template>
  <Teleport to="body" :disabled="disableTeleport">
    <Transition name="modal">
      <div
        v-if="isOpen"
        class="wizard-overlay"
        data-testid="slash-command-wizard"
        @click.self="close"
        @keydown.escape="close"
      >
        <div
          class="wizard-modal"
          role="dialog"
          aria-labelledby="wizard-title"
        >
          <header class="wizard-header">
            <h2
              id="wizard-title"
              class="wizard-title"
            >
              {{ step === 1 ? 'Slash Commands' : `Configure /${selectedCommand?.name}` }}
            </h2>
            <button
              type="button"
              class="close-btn"
              aria-label="Close wizard"
              @click="close"
            >
              ×
            </button>
          </header>

          <div class="wizard-content">
            <!-- Step 1: Command Selection -->
            <CommandGrid
              v-if="step === 1"
              :commands="filteredCommands"
              :loading="commandsStore.loading"
              :error="commandsStore.error"
              :hide-builtin="hideBuiltin"
              @select="selectCommand"
              @close="close"
            />

            <!-- Step 2: Arguments Form (if command has args) -->
            <ArgumentsForm
              v-else-if="step === 2 && selectedCommand"
              :command="selectedCommand"
              :executing="executing"
              :execute-label="executeLabel"
              @back="goBack"
              @submit="handleExecute"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useSlashCommandsStore } from '../stores/slashCommands.js';
import { useUiStore } from '../stores/ui.js';
import { useOverlayTeleportDisabled } from '../composables/useOverlayStore.js';

const disableTeleport = useOverlayTeleportDisabled();
import CommandGrid from './slash-commands/CommandGrid.vue';
import ArgumentsForm from './slash-commands/ArgumentsForm.vue';

const props = defineProps({
  isOpen: { type: Boolean, required: true },
  sessionId: { type: String, default: null },
  workingDirectory: { type: String, default: null },
  hideBuiltin: { type: Boolean, default: false },
  mode: {
    type: String,
    default: 'execute', // 'execute' for ConversationTab, 'insert' for NewSessionView
    validator: (v) => ['execute', 'insert'].includes(v),
  },
});

const emit = defineEmits(['update:isOpen', 'executed', 'insert']);

const commandsStore = useSlashCommandsStore();
const uiStore = useUiStore();

const step = ref(1);
const selectedCommand = ref(null);
const executing = ref(false);

// Commands to display (optionally filter built-in for NewSessionView)
const filteredCommands = computed(() => {
  if (props.hideBuiltin) {
    return commandsStore.customCommands;
  }
  return commandsStore.commands;
});

// Dynamic execute button label
const executeLabel = computed(() => {
  if (props.mode === 'insert') {
    return 'Insert Command';
  }
  return 'Execute Command';
});

// Fetch commands when wizard opens (lazy loading)
// Always query SDK directly - no caching, always fresh commands
watch(
  () => props.isOpen,
  async (isOpen) => {
    if (isOpen) {
      step.value = 1;
      selectedCommand.value = null;
      // Debug logging to help trace workingDirectory issues
      console.log('[SlashCommandWizard] Opening wizard, workingDirectory:', props.workingDirectory);
      try {
        if (props.workingDirectory) {
          // Query SDK for commands (starts a Claude Code process to get fresh list)
          await commandsStore.fetchCommands(props.workingDirectory);
          console.log('[SlashCommandWizard] Fetched commands:', commandsStore.commands.length, 'commands');
        } else {
          console.warn('[SlashCommandWizard] No workingDirectory provided, skipping command fetch');
        }
      } catch (err) {
        console.error('[SlashCommandWizard] Failed to fetch commands:', err);
      }
    }
  }
);

function close() {
  emit('update:isOpen', false);
  // Reset state
  step.value = 1;
  selectedCommand.value = null;
}

function selectCommand(cmd) {
  selectedCommand.value = cmd;

  // For skills: always show the args form so the user can provide context
  if (cmd.isSkill) {
    step.value = 2;
    return;
  }

  // For commands: check if it has arguments
  if (!cmd.arguments || cmd.arguments.length === 0) {
    handleExecute({});
  } else {
    // Go to step 2 to fill in arguments
    step.value = 2;
  }
}

function goBack() {
  step.value = 1;
  selectedCommand.value = null;
}

async function handleExecute(args) {
  if (!selectedCommand.value) return;

  if (props.mode === 'insert') {
    // Build the command string for insertion
    const commandString = buildInsertString(selectedCommand.value, args);
    emit('insert', {
      command: selectedCommand.value,
      args,
      text: commandString,
    });
    close();
    return;
  }

  // Execute mode - send to session
  if (!props.sessionId) {
    uiStore.error('No session available to execute command');
    return;
  }

  executing.value = true;
  try {
    await commandsStore.executeCommand(
      props.sessionId,
      selectedCommand.value.name,
      args
    );
    emit('executed', {
      command: selectedCommand.value,
      args,
    });
    // Show success message BEFORE close() which sets selectedCommand to null
    uiStore.success(`Command /${selectedCommand.value.name} executed`);
    close();
  } catch (err) {
    uiStore.error(`Failed to execute command: ${err.message}`);
  } finally {
    executing.value = false;
  }
}

/**
 * Build command string for insertion into text field
 */
function buildInsertString(command, args) {
  let result = `/${command.name}`;

  // For skills, use raw args
  if (command.isSkill) {
    const rawArgs = args._raw || '';
    if (rawArgs) {
      result += ` ${rawArgs}`;
    }
    return result;
  }

  // For commands, use structured arguments
  const argValues = [];
  for (const argDef of command.arguments || []) {
    const value = args[argDef.name];
    if (value !== undefined && value !== '') {
      // Quote values with spaces
      if (typeof value === 'string' && value.includes(' ')) {
        argValues.push(`"${value}"`);
      } else {
        argValues.push(String(value));
      }
    }
  }

  if (argValues.length > 0) {
    result += ` ${argValues.join(' ')}`;
  }

  return result;
}
</script>

<style scoped>
.wizard-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
  z-index: 1000;
}

.wizard-modal {
  width: 100%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.wizard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.wizard-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text);
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  font-size: 1.5rem;
  font-weight: 400;
  background: transparent;
  border: none;
  border-radius: 0.375rem;
  color: var(--color-text-soft);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.close-btn:hover {
  background: var(--color-background-soft);
  color: var(--color-text);
}

.wizard-content {
  flex: 1;
  padding: 1.25rem;
  overflow-y: auto;
}

/* Modal transition */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active .wizard-modal,
.modal-leave-active .wizard-modal {
  transition: transform 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .wizard-modal {
  transform: scale(0.95) translateY(-10px);
}

.modal-leave-to .wizard-modal {
  transform: scale(0.95) translateY(10px);
}

/* Mobile responsive */
@media (max-width: 640px) {
  .wizard-modal {
    margin: 1rem;
    max-height: calc(100vh - 2rem);
  }
}
</style>
