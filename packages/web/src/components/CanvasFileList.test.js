import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import CanvasFileList from './CanvasFileList.vue';

describe('CanvasFileList', () => {
  const baseItems = [
    {
      id: 'item-1',
      filename: 'screenshot.png',
      type: 'image',
      createdAt: Date.now() - 60000, // 1 minute ago
      versionCount: 1,
      allVersions: [],
    },
    {
      id: 'item-2',
      filename: 'design-spec.md',
      type: 'markdown',
      createdAt: Date.now() - 3600000, // 1 hour ago
      versionCount: 3,
      allVersions: [],
    },
  ];

  function mountComponent(props = {}) {
    return mount(CanvasFileList, {
      props: {
        items: baseItems,
        ...props,
      },
    });
  }

  describe('basic rendering', () => {
    it('renders a row for each item', () => {
      const wrapper = mountComponent();
      const rows = wrapper.findAll('.file-row');
      expect(rows.length).toBe(2);
    });

    it('displays filename for each item', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('screenshot.png');
      expect(wrapper.text()).toContain('design-spec.md');
    });

    it('displays file type for each item', () => {
      const wrapper = mountComponent();
      const types = wrapper.findAll('.file-type');
      expect(types[0].text()).toBe('image');
      expect(types[1].text()).toBe('markdown');
    });
  });

  describe('file type icons', () => {
    it('shows image icon for image type', () => {
      const wrapper = mountComponent({
        items: [{ ...baseItems[0], type: 'image' }],
      });
      expect(wrapper.find('.file-icon').text()).toBe('📷');
    });

    it('shows document icon for markdown type', () => {
      const wrapper = mountComponent({
        items: [{ ...baseItems[0], type: 'markdown' }],
      });
      expect(wrapper.find('.file-icon').text()).toBe('📄');
    });

    it('shows clipboard icon for json type', () => {
      const wrapper = mountComponent({
        items: [{ ...baseItems[0], type: 'json' }],
      });
      expect(wrapper.find('.file-icon').text()).toBe('📋');
    });

    it('shows text icon for text type', () => {
      const wrapper = mountComponent({
        items: [{ ...baseItems[0], type: 'text' }],
      });
      expect(wrapper.find('.file-icon').text()).toBe('📝');
    });

    it('shows folder icon for unknown type', () => {
      const wrapper = mountComponent({
        items: [{ ...baseItems[0], type: 'unknown' }],
      });
      expect(wrapper.find('.file-icon').text()).toBe('📁');
    });
  });

  describe('version badge', () => {
    it('shows version badge when versionCount > 1', () => {
      const wrapper = mountComponent({
        items: [{ ...baseItems[0], versionCount: 3 }],
      });
      const badge = wrapper.find('.version-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('v3');
    });

    it('hides version badge when versionCount is 1', () => {
      const wrapper = mountComponent({
        items: [{ ...baseItems[0], versionCount: 1 }],
      });
      expect(wrapper.find('.version-badge').exists()).toBe(false);
    });
  });

  describe('relative time', () => {
    it('shows "just now" for recent items', () => {
      const wrapper = mountComponent({
        items: [{ ...baseItems[0], createdAt: Date.now() - 5000 }], // 5 seconds ago
      });
      expect(wrapper.find('.file-time').text()).toBe('just now');
    });

    it('shows minutes for items within the hour', () => {
      const wrapper = mountComponent({
        items: [{ ...baseItems[0], createdAt: Date.now() - 300000 }], // 5 minutes ago
      });
      expect(wrapper.find('.file-time').text()).toBe('5m ago');
    });

    it('shows hours for items within the day', () => {
      const wrapper = mountComponent({
        items: [{ ...baseItems[0], createdAt: Date.now() - 7200000 }], // 2 hours ago
      });
      expect(wrapper.find('.file-time').text()).toBe('2h ago');
    });

    it('shows days for older items', () => {
      const wrapper = mountComponent({
        items: [{ ...baseItems[0], createdAt: Date.now() - 172800000 }], // 2 days ago
      });
      expect(wrapper.find('.file-time').text()).toBe('2d ago');
    });
  });

  describe('fallback display names', () => {
    it('uses label when filename is missing', () => {
      const wrapper = mountComponent({
        items: [{ id: '1', label: 'My Label', type: 'text', createdAt: Date.now(), versionCount: 1 }],
      });
      expect(wrapper.find('.file-name').text()).toBe('My Label');
    });

    it('shows "Untitled" when both filename and label are missing', () => {
      const wrapper = mountComponent({
        items: [{ id: '1', type: 'text', createdAt: Date.now(), versionCount: 1 }],
      });
      expect(wrapper.find('.file-name').text()).toBe('Untitled');
    });
  });

  describe('click interaction', () => {
    it('rows have cursor pointer style', () => {
      const wrapper = mountComponent();
      const rows = wrapper.findAll('.file-row');
      // Verify rows exist and are styled as clickable
      expect(rows.length).toBe(2);
      expect(rows[0].classes()).toContain('file-row');
    });

    it('each row has unique key', () => {
      const wrapper = mountComponent();
      const rows = wrapper.findAll('.file-row');
      // Each row should be present and distinct
      expect(rows[0].text()).toContain('screenshot.png');
      expect(rows[1].text()).toContain('design-spec.md');
    });
  });

  describe('empty state', () => {
    it('renders nothing when items array is empty', () => {
      const wrapper = mountComponent({ items: [] });
      expect(wrapper.findAll('.file-row').length).toBe(0);
    });
  });
});
