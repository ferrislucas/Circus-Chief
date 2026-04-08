/**
 * Guard test: verifies that components rendered inside the overlay tree do NOT
 * directly import useSessionsStore or useTodosStore. They should use the injected
 * versions (useInjectedSessionsStore / useInjectedTodosStore) from useOverlayStore.js.
 *
 * Uses Vite's ?raw import suffix to read component sources at build time,
 * which works in the jsdom test environment.
 */
import { describe, it, expect } from 'vitest';

// Import component sources as raw text via Vite's ?raw query
import ConversationTab from './ConversationTab.vue?raw';
import SessionChatPicker from './SessionChatPicker.vue?raw';
import ConversationPanel from './ConversationPanel.vue?raw';
import ConversationMessages from './ConversationMessages.vue?raw';
import ConversationTreeItem from './ConversationTreeItem.vue?raw';
import TokenCostPanel from './TokenCostPanel.vue?raw';
import SchedulingInfo from './SchedulingInfo.vue?raw';
import SchedulingEditModal from './SchedulingEditModal.vue?raw';
import ScheduleSessionModal from './ScheduleSessionModal.vue?raw';
import AutoRescheduleModal from './AutoRescheduleModal.vue?raw';
import ModeSelector from './ModeSelector.vue?raw';
import EffortLevelSelector from './EffortLevelSelector.vue?raw';
import TodoDrawer from './TodoDrawer.vue?raw';
import InputForm from './InputForm.vue?raw';
import RunningState from './RunningState.vue?raw';
import StreamingMessage from './StreamingMessage.vue?raw';
import MessageItem from './MessageItem.vue?raw';
import StaleBadge from './StaleBadge.vue?raw';
import QuickResponseSettings from './QuickResponseSettings.vue?raw';
import LiveWorkLogPanel from './LiveWorkLogPanel.vue?raw';
import ModelSelector from './ModelSelector.vue?raw';

const overlayComponents = [
  { name: 'ConversationTab.vue', source: ConversationTab },
  { name: 'SessionChatPicker.vue', source: SessionChatPicker },
  { name: 'ConversationPanel.vue', source: ConversationPanel },
  { name: 'ConversationMessages.vue', source: ConversationMessages },
  { name: 'ConversationTreeItem.vue', source: ConversationTreeItem },
  { name: 'TokenCostPanel.vue', source: TokenCostPanel },
  { name: 'SchedulingInfo.vue', source: SchedulingInfo },
  { name: 'SchedulingEditModal.vue', source: SchedulingEditModal },
  { name: 'ScheduleSessionModal.vue', source: ScheduleSessionModal },
  { name: 'AutoRescheduleModal.vue', source: AutoRescheduleModal },
  { name: 'ModeSelector.vue', source: ModeSelector },
  { name: 'EffortLevelSelector.vue', source: EffortLevelSelector },
  { name: 'TodoDrawer.vue', source: TodoDrawer },
  { name: 'InputForm.vue', source: InputForm },
  { name: 'RunningState.vue', source: RunningState },
  { name: 'StreamingMessage.vue', source: StreamingMessage },
  { name: 'MessageItem.vue', source: MessageItem },
  { name: 'StaleBadge.vue', source: StaleBadge },
  { name: 'QuickResponseSettings.vue', source: QuickResponseSettings },
  { name: 'LiveWorkLogPanel.vue', source: LiveWorkLogPanel },
  { name: 'ModelSelector.vue', source: ModelSelector },
];

// Regex patterns to detect direct imports from stores/sessions or stores/todos
// Handles various relative path depths (../, ../../, etc.)
const sessionsStoreImportRegex = /from\s+['"](?:\.\.\/)+stores\/sessions(?:\.js)?['"]/;
const todosStoreImportRegex = /from\s+['"](?:\.\.\/)+stores\/todos(?:\.js)?['"]/;

describe('Overlay Component Import Guard', () => {
  it.each(overlayComponents.map(c => [c.name, c.source]))(
    '%s should not directly import useSessionsStore or useTodosStore',
    (componentFile, source) => {
      const hasSessionsStoreImport = sessionsStoreImportRegex.test(source);
      const hasTodosStoreImport = todosStoreImportRegex.test(source);

      if (hasSessionsStoreImport) {
        expect.fail(
          `${componentFile} directly imports from stores/sessions. ` +
          `Use useInjectedSessionsStore() from composables/useOverlayStore.js instead.`,
        );
      }

      if (hasTodosStoreImport) {
        expect.fail(
          `${componentFile} directly imports from stores/todos. ` +
          `Use useInjectedTodosStore() from composables/useOverlayStore.js instead.`,
        );
      }

      expect(hasSessionsStoreImport).toBe(false);
      expect(hasTodosStoreImport).toBe(false);
    },
  );
});
