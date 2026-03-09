<template>
  <div class="container">
    <router-link :to="`/projects/${route.params.id}/sessions`" class="back-link">
      &larr; Sessions
    </router-link>
    <h1>New Session</h1>

    <form @submit.prevent="handleSubmit" class="form card">
      <!-- NEW: Start From Template selector - populates all fields -->
      <div v-if="allTemplates.length > 0" class="form-group template-prefill-section">
        <label class="form-label" for="start-from-template">Start From Template (optional)</label>
        <select id="start-from-template" v-model="startFromTemplateId" class="form-input" @change="handleStartFromTemplateChange">
          <option :value="null">Select a template to pre-fill the form...</option>
          <optgroup v-if="projectTemplates.length" label="Project Templates">
            <option v-for="template in projectTemplates" :key="template.id" :value="template.id">
              {{ template.name }}
            </option>
          </optgroup>
          <optgroup v-if="globalTemplates.length" label="Global Templates">
            <option v-for="template in globalTemplates" :key="template.id" :value="template.id">
              {{ template.name }}
            </option>
          </optgroup>
        </select>
        <p class="form-help">
          Selecting a template will populate all form fields below. You can still edit before starting.
        </p>
      </div>

      <div class="form-group">
        <ResizableTextarea
          id="prompt"
          ref="textareaRef"
          class="form-input form-textarea"
          placeholder="What would you like Claude to help you with?"
          :min-height="120"
          required
          @input="handleInput"
          @keydown="handleKeydown"
        />
        <div class="attachment-row">
          <FileAttachment ref="fileAttachment" @update:files="attachedFiles = $event" />
          <SlashCommandButton
            v-if="workingDirectory"
            @open="showSlashCommandWizard = true"
          />
        </div>
      </div>

      <SessionFormOptions
        v-model:mode="mode"
        v-model:model="model"
        v-model:thinkingEnabled="thinkingEnabled"
        v-model:startImmediately="startImmediately"
        @update:providerId="providerId = $event"
      />

      <div v-if="error" class="error-message">{{ error }}</div>

      <!-- Scheduling Options -->
      <SchedulingOptions v-model="schedulingData" />

      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-full-width" :disabled="loading">
          <span v-if="loading" class="loading-spinner"></span>
          {{ startImmediately ? 'Start Session' : 'Create Draft' }}
        </button>
      </div>

      <!-- Git Options -->
      <GitOptionsSection
        :gitStatus="gitStatus"
        :quickGitMode="quickGitMode"
        :quickWorktreeBranch="quickWorktreeBranch"
        :autoBranchName="autoBranchName"
        :editingBranch="editingBranch"
        :loadingGit="loadingGit"
        @update:quickGitMode="quickGitMode = $event"
        @update:quickWorktreeBranch="quickWorktreeBranch = $event"
        @branchEdit="handleBranchEdit"
        @resetBranch="resetBranchName"
      />

      <!-- Next Template (optional) -->
      <div v-if="allTemplates.length > 0" class="form-group">
        <label class="form-label" for="template">Next Template (optional)</label>
        <select id="template" v-model="selectedTemplateId" class="form-input">
          <option :value="null">None - single session</option>
          <optgroup v-if="projectTemplates.length" label="Project Templates">
            <option v-for="template in projectTemplates" :key="template.id" :value="template.id">
              {{ template.name }}
            </option>
          </optgroup>
          <optgroup v-if="globalTemplates.length" label="Global Templates">
            <option v-for="template in globalTemplates" :key="template.id" :value="template.id">
              {{ template.name }}
            </option>
          </optgroup>
        </select>
        <p class="form-help">
          After this session completes, the selected template will automatically start a new session.
        </p>
      </div>

      <!-- Parent Session (optional) -->
      <div v-if="availableSessions.length > 0" class="form-group">
        <label class="form-label" for="parent-session">Parent Session (optional)</label>
        <select id="parent-session" v-model="parentSessionId" class="form-input">
          <option :value="null">None - create standalone session</option>
          <option v-for="session in availableSessions" :key="session.id" :value="session.id">
            {{ session.name }}
          </option>
        </select>
        <p class="form-help">
          Choose a parent session to link this as a child session. Child sessions help organize related work.
        </p>
      </div>
    </form>

    <!-- Quick Response Settings Modal -->
    <QuickResponseSettings
      :isOpen="quickResponseSettingsOpen"
      :projectId="route.params.id"
      @close="quickResponseSettingsOpen = false"
    />

    <!-- Slash Command Wizard Modal -->
    <SlashCommandWizard
      v-model:isOpen="showSlashCommandWizard"
      :workingDirectory="workingDirectory || ''"
      mode="insert"
      :hide-builtin="true"
      @insert="handleSlashCommandInsert"
    />
  </div>
</template>

<script setup>
import { useNewSession } from '../composables/useNewSession.js';
import FileAttachment from '../components/FileAttachment.vue';
import QuickResponsesPanel from '../components/QuickResponsesPanel.vue';
import QuickResponseSettings from '../components/QuickResponseSettings.vue';
import SchedulingOptions from '../components/SchedulingOptions.vue';
import ResizableTextarea from '../components/ResizableTextarea.vue';
import SlashCommandButton from '../components/SlashCommandButton.vue';
import SlashCommandWizard from '../components/SlashCommandWizard.vue';
import SessionFormOptions from '../components/SessionFormOptions.vue';
import GitOptionsSection from '../components/GitOptionsSection.vue';

const {
  // Route
  route,

  // Form state
  textareaRef,
  mode,
  model,
  providerId,
  loading,
  error,
  quickResponseSettingsOpen,
  showSlashCommandWizard,
  thinkingEnabled,
  startImmediately,
  schedulingData,
  attachedFiles,
  fileAttachment,
  selectedTemplateId,
  startFromTemplateId,
  parentSessionId,

  // Git state
  gitStatus,
  loadingGit,
  quickGitMode,
  quickWorktreeBranch,
  editingBranch,
  autoBranchName,

  // Computed
  projectTemplates,
  globalTemplates,
  allTemplates,
  workingDirectory,
  availableSessions,

  // Handlers
  handleKeydown,
  handleInput,
  handleSubmit,
  handleBranchEdit,
  resetBranchName,
  handleSlashCommandInsert,
  handleQuickResponseInsert,
  handleStartFromTemplateChange,
} = useNewSession();
</script>

<style scoped>
.back-link {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  display: inline-block;
  margin-bottom: 0.25rem;
  margin-top: 0;
}

h1 {
  margin-bottom: 0.5rem;
  margin-top: 0;
}

.form {
  width: 100%;
}

.form-help {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.template-prefill-section {
  background-color: var(--color-bg-soft);
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px dashed var(--color-border);
  margin-bottom: 1rem;
}

.attachment-row {
  margin-top: 0.5rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.form-actions {
  margin-bottom: 1.5rem;
}

.btn-full-width {
  width: 100%;
  padding-top: 1rem;
  padding-bottom: 1rem;
  font-size: 1.1rem;
}

.error-message {
  color: var(--color-error);
  margin-bottom: 1rem;
}

/* Mobile responsive styles */
@media (max-width: 480px) {
  h1 {
    margin-bottom: 0.5rem;
    font-size: 1.5rem;
  }
}
</style>
