import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import GitOptionsPanel from './GitOptionsPanel.vue';

const defaultGitStatus = { isGitRepo: true, currentBranch: 'main' };

// Track DOM nodes to clean up after each test
const attachedNodes = [];

afterEach(() => {
  attachedNodes.forEach(node => {
    if (node.parentNode) node.parentNode.removeChild(node);
  });
  attachedNodes.length = 0;
});

function mountPanel(props = {}, { attachTo = false } = {}) {
  const options = {
    props: {
      gitStatus: defaultGitStatus,
      modelValue: 'current',
      branchName: '',
      autoBranchName: '',
      editingBranch: false,
      loadingGit: false,
      ...props,
    },
  };

  if (attachTo) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    attachedNodes.push(div);
    options.attachTo = div;
  }

  return mount(GitOptionsPanel, options);
}

describe('GitOptionsPanel', () => {
  it('renders segmented control with Worktree, Branch, Current buttons when git repo detected', () => {
    const wrapper = mountPanel();

    const buttons = wrapper.findAll('.segment-btn');
    expect(buttons).toHaveLength(3);

    const labels = buttons.map(b => b.text());
    expect(labels[0]).toContain('Worktree');
    expect(labels[1]).toContain('Branch');
    expect(labels[2]).toContain('Current');
  });

  it('shows abbreviated label element (segment-label-short) for Worktree button', () => {
    const wrapper = mountPanel();

    const firstBtn = wrapper.find('.segment-btn');
    // Both labels are in the DOM; CSS controls visibility via media query
    expect(firstBtn.find('.segment-label-full').exists()).toBe(true);
    expect(firstBtn.find('.segment-label-short').exists()).toBe(true);
    expect(firstBtn.find('.segment-label-full').text()).toBe('Worktree');
    expect(firstBtn.find('.segment-label-short').text()).toBe('WT');
  });

  it('does not render when gitStatus.isGitRepo is false', () => {
    const wrapper = mountPanel({ gitStatus: { isGitRepo: false, currentBranch: '' } });

    expect(wrapper.find('.segmented-control').exists()).toBe(false);
  });

  it('emits update:modelValue when a segment button is clicked', async () => {
    // GitOptionsPanel has a multi-root (fragment) template, which means VTU's
    // wrapper.emitted() may not capture events. Use a parent wrapper instead.
    const emittedValues = [];
    const Parent = defineComponent({
      components: { GitOptionsPanel },
      setup() {
        const value = ref('current');
        function onUpdate(v) { emittedValues.push(v); }
        return { value, onUpdate };
      },
      template: `<GitOptionsPanel
        :gitStatus="{ isGitRepo: true, currentBranch: 'main' }"
        :modelValue="value"
        branchName=""
        autoBranchName=""
        :editingBranch="false"
        :loadingGit="false"
        @update:modelValue="onUpdate"
      />`,
    });

    const wrapper = mount(Parent);
    const buttons = wrapper.findAll('.segment-btn');
    // Click the "Branch" button (index 1)
    await buttons[1].trigger('click');

    expect(emittedValues).toHaveLength(1);
    expect(emittedValues[0]).toBe('branch');
  });

  it('shows branch input when modelValue is "worktree" or "branch"', async () => {
    const wrapperWorktree = mountPanel({ modelValue: 'worktree' });
    expect(wrapperWorktree.find('.branch-input-row').exists()).toBe(true);

    const wrapperBranch = mountPanel({ modelValue: 'branch' });
    expect(wrapperBranch.find('.branch-input-row').exists()).toBe(true);

    const wrapperCurrent = mountPanel({ modelValue: 'current' });
    expect(wrapperCurrent.find('.branch-input-row').exists()).toBe(false);
  });
});
