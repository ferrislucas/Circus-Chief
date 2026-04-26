import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { mount } from '@vue/test-utils';
import CommandGrid from './CommandGrid.vue';

describe('CommandGrid.vue', () => {
  describe('skill sections rendering', () => {
    it('renders Project Skills section when project skills exist', () => {
      const commands = [
        {
          name: 'project-skill-1',
          source: 'project-skill',
          isSkill: true,
          description: 'A project skill',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const section = wrapper.find('.section-title');
      expect(section.text()).toBe('Project Skills');
    });

    it('renders User Skills section when user skills exist', () => {
      const commands = [
        {
          name: 'user-skill-1',
          source: 'user-skill',
          isSkill: true,
          description: 'A user skill',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const section = wrapper.find('.section-title');
      expect(section.text()).toBe('User Skills');
    });

    it('renders Plugin Skills section when plugin skills exist', () => {
      const commands = [
        {
          name: 'plugin:skill-1',
          source: 'plugin-skill',
          isSkill: true,
          description: 'A plugin skill',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const section = wrapper.find('.section-title');
      expect(section.text()).toBe('Plugin Skills');
    });

    it('does not render skill sections when no skills exist', () => {
      const commands = [
        {
          name: 'deploy',
          source: 'project',
          description: 'Deploy command',
          arguments: [],
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const sections = wrapper.findAll('.section-title');
      const skillSections = sections.filter(
        (s) =>
          s.text() === 'Project Skills' ||
          s.text() === 'User Skills' ||
          s.text() === 'Plugin Skills'
      );

      expect(skillSections).toHaveLength(0);
    });
  });

  describe('skill cards rendering', () => {
    it('renders skill cards with correct data-testid', () => {
      const commands = [
        {
          name: 'my-skill',
          source: 'project-skill',
          isSkill: true,
          description: 'Test skill',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const skillCard = wrapper.find('[data-testid="skill-my-skill"]');
      expect(skillCard.exists()).toBe(true);
    });

    it('displays skill name with forward slash prefix', () => {
      const commands = [
        {
          name: 'process',
          source: 'project-skill',
          isSkill: true,
          description: 'Process files',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const skillName = wrapper.find('.command-name');
      expect(skillName.text()).toBe('/process');
    });

    it('displays skill description', () => {
      const commands = [
        {
          name: 'analyze',
          source: 'project-skill',
          isSkill: true,
          description: 'Analyze the codebase',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const description = wrapper.find('.command-description');
      expect(description.text()).toBe('Analyze the codebase');
    });

    it('displays "No description" when skill has no description', () => {
      const commands = [
        {
          name: 'my-skill',
          source: 'project-skill',
          isSkill: true,
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const description = wrapper.find('.command-description');
      expect(description.text()).toBe('No description');
    });

    it('displays argumentHint badge when skill has argumentHint', () => {
      const commands = [
        {
          name: 'copy',
          source: 'project-skill',
          isSkill: true,
          description: 'Copy files',
          argumentHint: '[source] [dest]',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const badge = wrapper.find('.command-args-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('[source] [dest]');
    });

    it('does not display badge when skill has no argumentHint', () => {
      const commands = [
        {
          name: 'simple',
          source: 'project-skill',
          isSkill: true,
          description: 'Simple skill',
          argumentHint: null,
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const badge = wrapper.find('.command-args-badge');
      expect(badge.exists()).toBe(false);
    });
  });

  describe('command cards vs skill cards', () => {
    it('displays argument count badge for commands', () => {
      const commands = [
        {
          name: 'deploy',
          source: 'project',
          description: 'Deploy app',
          arguments: [
            { name: 'env', label: 'Environment', type: 'text', required: true },
            { name: 'verbose', label: 'Verbose', type: 'text', required: false },
          ],
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const badge = wrapper.find('.command-args-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('2 args');
    });

    it('displays argumentHint for skills instead of arg count', () => {
      const commands = [
        {
          name: 'skill',
          source: 'project-skill',
          isSkill: true,
          description: 'A skill',
          argumentHint: '[file]',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const badge = wrapper.find('.command-args-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('[file]');
    });
  });

  describe('skill filtering by search', () => {
    it('filters project skills by name', async () => {
      const commands = [
        {
          name: 'analyze',
          source: 'project-skill',
          isSkill: true,
          description: 'Analyze code',
        },
        {
          name: 'process',
          source: 'project-skill',
          isSkill: true,
          description: 'Process files',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const searchInput = wrapper.find('[data-testid="command-search"]');
      await searchInput.setValue('analyze');

      const skillCards = wrapper.findAll('[data-testid^="skill-"]');
      expect(skillCards).toHaveLength(1);
      expect(skillCards[0].attributes('data-testid')).toBe('skill-analyze');
    });

    it('filters skills by description', async () => {
      const commands = [
        {
          name: 'skill1',
          source: 'project-skill',
          isSkill: true,
          description: 'Process the codebase',
        },
        {
          name: 'skill2',
          source: 'project-skill',
          isSkill: true,
          description: 'Analyze files',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const searchInput = wrapper.find('[data-testid="command-search"]');
      await searchInput.setValue('codebase');

      const skillCards = wrapper.findAll('[data-testid^="skill-"]');
      expect(skillCards).toHaveLength(1);
      expect(skillCards[0].attributes('data-testid')).toBe('skill-skill1');
    });

    it('shows all skills when search is cleared', async () => {
      const commands = [
        {
          name: 'skill1',
          source: 'project-skill',
          isSkill: true,
          description: 'Skill 1',
        },
        {
          name: 'skill2',
          source: 'project-skill',
          isSkill: true,
          description: 'Skill 2',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const searchInput = wrapper.find('[data-testid="command-search"]');
      await searchInput.setValue('skill1');

      let skillCards = wrapper.findAll('[data-testid^="skill-"]');
      expect(skillCards).toHaveLength(1);

      await searchInput.setValue('');

      skillCards = wrapper.findAll('[data-testid^="skill-"]');
      expect(skillCards).toHaveLength(2);
    });
  });

  describe('skill selection', () => {
    it('renders skill card as clickable button', () => {
      const skill = {
        name: 'my-skill',
        source: 'project-skill',
        isSkill: true,
        description: 'Test skill',
      };

      const wrapper = mount(CommandGrid, {
        props: {
          commands: [skill],
        },
      });

      const skillCard = wrapper.find('[data-testid="skill-my-skill"]');
      expect(skillCard.exists()).toBe(true);
      expect(skillCard.element.tagName).toBe('BUTTON');
      expect(skillCard.attributes('type')).toBe('button');
    });
  });

  describe('multiple skill sources', () => {
    it('renders all three skill sections when all types exist', () => {
      const commands = [
        {
          name: 'project-skill',
          source: 'project-skill',
          isSkill: true,
          description: 'Project skill',
        },
        {
          name: 'user-skill',
          source: 'user-skill',
          isSkill: true,
          description: 'User skill',
        },
        {
          name: 'plugin-skill',
          source: 'plugin-skill',
          isSkill: true,
          description: 'Plugin skill',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const sections = wrapper.findAll('.section-title');
      const sectionTexts = sections.map((s) => s.text());

      expect(sectionTexts).toContain('Project Skills');
      expect(sectionTexts).toContain('User Skills');
      expect(sectionTexts).toContain('Plugin Skills');
    });

    it('separates skills into correct sections', () => {
      const commands = [
        {
          name: 'ps1',
          source: 'project-skill',
          isSkill: true,
          description: 'Project skill 1',
        },
        {
          name: 'ps2',
          source: 'project-skill',
          isSkill: true,
          description: 'Project skill 2',
        },
        {
          name: 'us1',
          source: 'user-skill',
          isSkill: true,
          description: 'User skill 1',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      // Find all sections
      const sections = wrapper.findAll('.command-section');
      const projectSection = sections.find((s) => s.find('.section-title').text() === 'Project Skills');
      const userSection = sections.find((s) => s.find('.section-title').text() === 'User Skills');

      const projectSkills = projectSection.findAll('[data-testid^="skill-"]');
      const userSkills = userSection.findAll('[data-testid^="skill-"]');

      expect(projectSkills).toHaveLength(2);
      expect(userSkills).toHaveLength(1);
    });
  });

  describe('mixed commands and skills', () => {
    it('displays both command and skill sections', () => {
      const commands = [
        {
          name: 'deploy',
          source: 'project',
          description: 'Deploy command',
          arguments: [],
        },
        {
          name: 'analyze',
          source: 'project-skill',
          isSkill: true,
          description: 'Analyze skill',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const sections = wrapper.findAll('.section-title');
      const sectionTexts = sections.map((s) => s.text());

      expect(sectionTexts).toContain('Project Commands');
      expect(sectionTexts).toContain('Project Skills');
    });

    it('filters both commands and skills with search', async () => {
      const commands = [
        {
          name: 'deploy',
          source: 'project',
          description: 'Deploy the app',
          arguments: [],
        },
        {
          name: 'analyze',
          source: 'project-skill',
          isSkill: true,
          description: 'Analyze the codebase',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const searchInput = wrapper.find('[data-testid="command-search"]');
      await searchInput.setValue('analyze');
      await wrapper.vm.$nextTick();

      const commandCards = wrapper.findAll('[data-testid="command-deploy"]');
      const skillCards = wrapper.findAll('[data-testid="skill-analyze"]');

      expect(commandCards).toHaveLength(0);
      expect(skillCards).toHaveLength(1);
    });
  });

  describe('empty states', () => {
    it('shows empty state when no skills match search', async () => {
      const commands = [
        {
          name: 'my-skill',
          source: 'project-skill',
          isSkill: true,
          description: 'A skill',
        },
      ];

      const wrapper = mount(CommandGrid, {
        props: {
          commands,
        },
      });

      const searchInput = wrapper.find('[data-testid="command-search"]');
      await searchInput.setValue('nonexistent');

      const emptyState = wrapper.find('.empty-state');
      expect(emptyState.exists()).toBe(true);
      expect(emptyState.text()).toContain('No commands match "nonexistent"');
    });
  });

  describe('style tokens', () => {
    it('uses defined theme tokens for command grid styling', () => {
      const source = readFileSync('src/components/slash-commands/CommandGrid.vue', 'utf8');

      expect(source).not.toMatch(/--color-(accent|accent-rgb|bg-hover|border-hover|primary-hover)\b/);
      expect(source).toContain('--color-primary');
      expect(source).toContain('--color-background-mute');
      expect(source).toContain('rgba(88, 166, 255, 0.15)');
    });
  });
});
