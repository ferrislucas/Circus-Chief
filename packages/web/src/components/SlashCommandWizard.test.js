import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SlashCommandWizard from './SlashCommandWizard.vue';
import CommandGrid from './slash-commands/CommandGrid.vue';
import ArgumentsForm from './slash-commands/ArgumentsForm.vue';
import { useSlashCommandsStore } from '../stores/slashCommands.js';
import { useUiStore } from '../stores/ui.js';

// Mock the API
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSlashCommands: vi.fn(),
    getSlashCommand: vi.fn(),
    executeSlashCommand: vi.fn(),
    getSession: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('SlashCommandWizard.vue', () => {
  let commandsStore;
  let uiStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    commandsStore = useSlashCommandsStore();
    uiStore = useUiStore();
    vi.clearAllMocks();

    // Mock fetchCommands to return some test commands
    api.getSlashCommands.mockResolvedValue([
      {
        name: 'test-cmd',
        source: 'project',
        description: 'A test command',
        arguments: [{ name: 'arg1', label: 'Argument 1', type: 'text', required: true }],
      },
      {
        name: 'no-args-cmd',
        source: 'project',
        description: 'Command with no args',
        arguments: [],
      },
    ]);
  });

  describe('skill handling - integration tests', () => {
    it('renders CommandGrid when open', async () => {
      // Set commands in store
      commandsStore.commands = [
        {
          name: 'my-skill',
          source: 'project-skill',
          isSkill: true,
          description: 'A test skill',
        },
      ];

      const wrapper = mount(SlashCommandWizard, {
        props: {
          isOpen: true,
          sessionId: 'test-session',
          workingDirectory: '/test',
          mode: 'execute',
        },
        global: {
          stubs: {
            Teleport: true,
          },
        },
      });

      const grid = wrapper.findComponent(CommandGrid);
      expect(grid.exists()).toBe(true);
    });

    it('shows ArgumentsForm after selecting skill with argumentHint', async () => {
      const skill = {
        name: 'args-skill',
        source: 'project-skill',
        isSkill: true,
        description: 'A skill with args',
        argumentHint: '[filename]',
      };

      commandsStore.commands = [skill];

      const wrapper = mount(SlashCommandWizard, {
        props: {
          isOpen: true,
          sessionId: 'test-session',
          workingDirectory: '/test',
          mode: 'execute',
        },
        global: {
          stubs: {
            Teleport: true,
          },
        },
      });

      const grid = wrapper.findComponent(CommandGrid);
      grid.vm.$emit('select', skill);

      await wrapper.vm.$nextTick();

      const argsForm = wrapper.findComponent(ArgumentsForm);
      expect(argsForm.exists()).toBe(true);
    });

    it('passes skill to ArgumentsForm when skill is selected', async () => {
      const skill = {
        name: 'process',
        source: 'project-skill',
        isSkill: true,
        description: 'Process files',
        argumentHint: '[file]',
      };

      commandsStore.commands = [skill];

      const wrapper = mount(SlashCommandWizard, {
        props: {
          isOpen: true,
          workingDirectory: '/test',
          mode: 'insert',
        },
        global: {
          stubs: {
            Teleport: true,
          },
        },
      });

      // Select skill
      const grid = wrapper.findComponent(CommandGrid);
      await grid.vm.$emit('select', skill);
      await wrapper.vm.$nextTick();

      // Check that ArgumentsForm receives the skill
      const argsForm = wrapper.findComponent(ArgumentsForm);
      expect(argsForm.exists()).toBe(true);
      expect(argsForm.props('command')).toEqual(skill);
      expect(argsForm.props('command').isSkill).toBe(true);
    });

    it('executes skill command when ArgumentsForm submits in execute mode', async () => {
      const skill = {
        name: 'analyze',
        source: 'project-skill',
        isSkill: true,
        argumentHint: '[target]',
      };

      api.executeSlashCommand.mockResolvedValue({ success: true });
      commandsStore.commands = [skill];

      const wrapper = mount(SlashCommandWizard, {
        props: {
          isOpen: true,
          sessionId: 'test-session',
          workingDirectory: '/test',
          mode: 'execute',
        },
        global: {
          stubs: {
            Teleport: true,
          },
        },
      });

      // Select skill
      const grid = wrapper.findComponent(CommandGrid);
      grid.vm.$emit('select', skill);

      await wrapper.vm.$nextTick();

      // Submit args form
      const argsForm = wrapper.findComponent(ArgumentsForm);
      argsForm.vm.$emit('submit', { _raw: 'codebase' });

      await wrapper.vm.$nextTick();

      expect(api.executeSlashCommand).toHaveBeenCalledWith('test-session', 'analyze', {
        _raw: 'codebase',
      });
    });

    it('shows ArgumentsForm for skills WITHOUT argumentHint (does not auto-execute)', async () => {
      const skill = {
        name: 'my-skill',
        source: 'project-skill',
        isSkill: true,
        description: 'A test skill',
        // No argumentHint
      };

      commandsStore.commands = [skill];

      const wrapper = mount(SlashCommandWizard, {
        props: {
          isOpen: true,
          workingDirectory: '/test',
          mode: 'insert',
        },
        global: { stubs: { Teleport: true } },
      });

      const grid = wrapper.findComponent(CommandGrid);
      grid.vm.$emit('select', skill);
      await wrapper.vm.$nextTick();

      // Should show ArgumentsForm, not auto-execute
      const argsForm = wrapper.findComponent(ArgumentsForm);
      expect(argsForm.exists()).toBe(true);
    });

    it('emits insert event with correct text when skill args form is submitted', async () => {
      const skill = {
        name: 'frontend-design',
        source: 'project-skill',
        isSkill: true,
        description: 'Create interfaces',
      };

      commandsStore.commands = [skill];

      // Use an onInsert listener via attrs since wrapper.emitted() doesn't work
      // reliably with Teleport stubs
      const insertSpy = vi.fn();
      const wrapper = mount(SlashCommandWizard, {
        props: {
          isOpen: true,
          workingDirectory: '/test',
          mode: 'insert',
        },
        attrs: {
          onInsert: insertSpy,
        },
        global: { stubs: { Teleport: true } },
      });

      // Select skill -> goes to step 2
      const grid = wrapper.findComponent(CommandGrid);
      grid.vm.$emit('select', skill);
      await wrapper.vm.$nextTick();

      // Verify step 2 is showing
      const argsForm = wrapper.findComponent(ArgumentsForm);
      expect(argsForm.exists()).toBe(true);

      // Type into the skill args input
      const input = argsForm.find('[data-testid="skill-args-input"]');
      await input.setValue('build a login page');

      // Submit via the form
      await argsForm.find('form').trigger('submit');
      await flushPromises();

      // Should emit insert with command string built by buildInsertString()
      expect(insertSpy).toHaveBeenCalledTimes(1);
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '/frontend-design build a login page',
        })
      );
    });
  });
});
