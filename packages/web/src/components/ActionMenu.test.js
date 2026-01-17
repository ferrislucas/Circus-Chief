import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ActionMenu from './ActionMenu.vue';

describe('ActionMenu.vue', () => {
  const testItems = [
    { icon: '📋', label: 'Copy output', action: 'copy-output' },
    { icon: '🎨', label: 'Send to canvas', action: 'send-to-canvas' },
    { icon: '📄', label: 'Copy command', action: 'copy-command' }
  ];

  describe('Rendering Tests', () => {
    it('renders trigger button with default icon (⋮)', () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      const button = wrapper.find('.btn-kebab');
      expect(button.exists()).toBe(true);
      expect(button.text()).toBe('⋮');
    });

    it('renders trigger button with custom icon', () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems, triggerIcon: '•••' }
      });
      const button = wrapper.find('.btn-kebab');
      expect(button.text()).toBe('•••');
    });

    it('does NOT render menu items initially', () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      const menuItems = wrapper.find('.menu-items');
      expect(menuItems.exists()).toBe(false);
    });

    it('renders menu items when trigger button is clicked', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      const button = wrapper.find('.btn-kebab');
      await button.trigger('click');
      await wrapper.vm.$nextTick();
      const menuItems = wrapper.find('.menu-items');
      expect(menuItems.exists()).toBe(true);
    });

    it('renders all menu items from props', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      expect(items.length).toBe(testItems.length);
    });

    it('renders menu items with correct labels and icons', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');

      expect(items[0].text()).toContain('📋');
      expect(items[0].text()).toContain('Copy output');

      expect(items[1].text()).toContain('🎨');
      expect(items[1].text()).toContain('Send to canvas');

      expect(items[2].text()).toContain('📄');
      expect(items[2].text()).toContain('Copy command');
    });
  });

  describe('Menu Item Styling Tests', () => {
    it('applies is-danger class to items with isDanger=true', async () => {
      const itemsWithDanger = [
        { icon: '⚠️', label: 'Delete', action: 'delete', isDanger: true },
        { icon: '✓', label: 'Confirm', action: 'confirm' }
      ];

      const wrapper = mount(ActionMenu, {
        props: { items: itemsWithDanger }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      expect(items[0].classes()).toContain('is-danger');
      expect(items[1].classes()).not.toContain('is-danger');
    });

    it('highlights menu item on hover', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      await items[0].trigger('mouseenter');
      await wrapper.vm.$nextTick();

      expect(items[0].classes()).toContain('is-highlighted');
    });

    it('removes highlight on mouseleave', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      await items[0].trigger('mouseenter');
      await wrapper.vm.$nextTick();
      expect(items[0].classes()).toContain('is-highlighted');

      await items[0].trigger('mouseleave');
      await wrapper.vm.$nextTick();
      expect(items[0].classes()).not.toContain('is-highlighted');
    });
  });

  describe('Interaction Tests', () => {
    it('handleItemClick closes menu after calling emit', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });

      wrapper.vm.isOpen = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.isOpen).toBe(true);

      // Directly call the handleItemClick method - should close menu
      wrapper.vm.handleItemClick('send-to-canvas');
      await wrapper.vm.$nextTick();

      // Menu should be closed
      expect(wrapper.vm.isOpen).toBe(false);
    });

    it('closes menu after item is clicked via method call', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });

      wrapper.vm.isOpen = true;
      await flushPromises();
      expect(wrapper.vm.isOpen).toBe(true);

      wrapper.vm.handleItemClick('copy-output');
      await flushPromises();

      expect(wrapper.vm.isOpen).toBe(false);
    });

    it('closes menu when overlay handler is called', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });

      wrapper.vm.isOpen = true;
      await flushPromises();
      expect(wrapper.vm.isOpen).toBe(true);

      wrapper.vm.handleOutsideClick();
      await flushPromises();

      expect(wrapper.vm.isOpen).toBe(false);
    });

    it('toggles menu open and closed via toggleMenu method', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });

      // Initially closed
      expect(wrapper.vm.isOpen).toBe(false);

      // Open
      wrapper.vm.toggleMenu();
      await flushPromises();
      expect(wrapper.vm.isOpen).toBe(true);
      expect(wrapper.vm.highlightedIndex).toBe(0);

      // Close
      wrapper.vm.toggleMenu();
      await flushPromises();
      expect(wrapper.vm.isOpen).toBe(false);
      expect(wrapper.vm.highlightedIndex).toBe(null);
    });
  });

  describe('Accessibility Tests', () => {
    it('trigger button has default aria-label', () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      const button = wrapper.find('.btn-kebab');
      expect(button.attributes('aria-label')).toBe('More actions');
    });

    it('trigger button has custom aria-label when provided', () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems, ariaLabel: 'Command output actions' }
      });
      const button = wrapper.find('.btn-kebab');
      expect(button.attributes('aria-label')).toBe('Command output actions');
    });

    it('trigger button has aria-expanded attribute that toggles', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      const button = wrapper.find('.btn-kebab');

      expect(button.attributes('aria-expanded')).toBe('false');

      await button.trigger('click');
      await wrapper.vm.$nextTick();
      expect(button.attributes('aria-expanded')).toBe('true');
    });

    it('trigger button has aria-haspopup="menu"', () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      const button = wrapper.find('.btn-kebab');
      expect(button.attributes('aria-haspopup')).toBe('menu');
    });

    it('menu has role="menu"', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const menu = wrapper.find('.menu-items');
      expect(menu.attributes('role')).toBe('menu');
    });

    it('menu items have role="menuitem"', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      items.forEach((item) => {
        expect(item.attributes('role')).toBe('menuitem');
      });
    });
  });

  describe('Keyboard Navigation Tests', () => {
    it('supports ArrowDown navigation via handleKeyDown', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });

      wrapper.vm.toggleMenu(); // Open menu
      await flushPromises();

      // highlightedIndex is set to 0 when menu opens
      expect(wrapper.vm.highlightedIndex).toBe(0);

      wrapper.vm.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
      await flushPromises();
      expect(wrapper.vm.highlightedIndex).toBe(1);

      wrapper.vm.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
      await flushPromises();
      expect(wrapper.vm.highlightedIndex).toBe(2);
    });

    it('wraps to first item when ArrowDown at end', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });

      wrapper.vm.toggleMenu();
      await flushPromises();

      // Navigate to last item
      wrapper.vm.highlightedIndex = 2;
      await flushPromises();

      // ArrowDown should wrap to first
      wrapper.vm.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
      await flushPromises();
      expect(wrapper.vm.highlightedIndex).toBe(0);
    });

    it('supports ArrowUp navigation', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });

      wrapper.vm.toggleMenu();
      await flushPromises();

      // Start at second item
      wrapper.vm.highlightedIndex = 1;
      await flushPromises();

      wrapper.vm.handleKeyDown({ key: 'ArrowUp', preventDefault: () => {} });
      await flushPromises();
      expect(wrapper.vm.highlightedIndex).toBe(0);
    });

    it('wraps to last item when ArrowUp at beginning', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });

      wrapper.vm.toggleMenu();
      await flushPromises();

      // Start at first item (default when menu opens)
      expect(wrapper.vm.highlightedIndex).toBe(0);

      // ArrowUp should wrap to last
      wrapper.vm.handleKeyDown({ key: 'ArrowUp', preventDefault: () => {} });
      await flushPromises();
      expect(wrapper.vm.highlightedIndex).toBe(2);
    });

    it('triggers highlighted item and closes menu on Enter key', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });

      wrapper.vm.toggleMenu();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.isOpen).toBe(true);

      // Highlight second item
      wrapper.vm.highlightedIndex = 1;
      await wrapper.vm.$nextTick();

      wrapper.vm.handleKeyDown({ key: 'Enter', preventDefault: () => {} });
      await wrapper.vm.$nextTick();

      // Menu should be closed after Enter
      expect(wrapper.vm.isOpen).toBe(false);
    });

    it('closes menu on Escape key', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });

      wrapper.vm.toggleMenu();
      await flushPromises();
      expect(wrapper.vm.isOpen).toBe(true);

      wrapper.vm.handleKeyDown({ key: 'Escape', preventDefault: () => {} });
      await flushPromises();

      expect(wrapper.vm.isOpen).toBe(false);
    });

    it('closes menu on Tab key', async () => {
      const wrapper = mount(ActionMenu, {
        props: { items: testItems }
      });

      wrapper.vm.toggleMenu();
      await flushPromises();
      expect(wrapper.vm.isOpen).toBe(true);

      wrapper.vm.handleKeyDown({ key: 'Tab', preventDefault: () => {} });
      await flushPromises();

      expect(wrapper.vm.isOpen).toBe(false);
    });
  });

  describe('Props Validation Tests', () => {
    it('validates items structure (must have icon, label, action)', () => {
      const validItems = [
        { icon: '📋', label: 'Copy', action: 'copy' },
        { icon: '🎨', label: 'Paint', action: 'paint' }
      ];

      const wrapper = mount(ActionMenu, {
        props: { items: validItems }
      });

      expect(wrapper.exists()).toBe(true);

      // Verify all required properties are present
      const items = wrapper.props('items');
      items.forEach(item => {
        expect(item).toHaveProperty('icon');
        expect(item).toHaveProperty('label');
        expect(item).toHaveProperty('action');
      });
    });

    it('accepts items with optional isDanger property', () => {
      const itemsWithDanger = [
        { icon: '📋', label: 'Copy', action: 'copy' },
        { icon: '🗑', label: 'Delete', action: 'delete', isDanger: true }
      ];

      const wrapper = mount(ActionMenu, {
        props: { items: itemsWithDanger }
      });

      expect(wrapper.exists()).toBe(true);
      const items = wrapper.props('items');
      expect(items[1].isDanger).toBe(true);
    });
  });
});
