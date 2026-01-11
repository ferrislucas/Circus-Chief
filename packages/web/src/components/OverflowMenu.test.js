import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import OverflowMenu from './OverflowMenu.vue';

describe('OverflowMenu.vue', () => {
  describe('Rendering Tests', () => {
    it('renders kebab button (⋮) that is always visible', () => {
      const wrapper = mount(OverflowMenu);
      const button = wrapper.find('.btn-kebab');
      expect(button.exists()).toBe(true);
      expect(button.text()).toBe('⋮');
    });

    it('does NOT render menu items initially', () => {
      const wrapper = mount(OverflowMenu);
      const menuItems = wrapper.find('.menu-items');
      expect(menuItems.exists()).toBe(false);
    });

    it('renders menu items when kebab button is clicked', async () => {
      const wrapper = mount(OverflowMenu);
      const button = wrapper.find('.btn-kebab');
      await button.trigger('click');
      await wrapper.vm.$nextTick();
      const menuItems = wrapper.find('.menu-items');
      expect(menuItems.exists()).toBe(true);
    });

    it('renders Duplicate, Archive, and Delete menu items', async () => {
      const wrapper = mount(OverflowMenu);
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      const texts = items.map(item => item.text());
      expect(texts.some(t => t.includes('Duplicate'))).toBe(true);
      expect(texts.some(t => t.includes('Archive'))).toBe(true);
      expect(texts.some(t => t.includes('Delete'))).toBe(true);
    });

    it('renders divider line between primary and delete actions', async () => {
      const wrapper = mount(OverflowMenu, {
        props: { showDivider: true }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();
      const divider = wrapper.find('.menu-divider');
      expect(divider.exists()).toBe(true);
    });

    it('hides divider when showDivider prop is false', async () => {
      const wrapper = mount(OverflowMenu, {
        props: { showDivider: false }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();
      const divider = wrapper.find('.menu-divider');
      expect(divider.exists()).toBe(false);
    });
  });


  describe('Menu Item Styling Tests', () => {
    it('applies is-danger class to Delete menu item', async () => {
      const wrapper = mount(OverflowMenu);
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      const deleteItem = items.find(item => item.text().includes('Delete'));
      expect(deleteItem.classes()).toContain('is-danger');
    });

    it('displays appropriate icons for menu items', async () => {
      const wrapper = mount(OverflowMenu);
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      const texts = items.map(item => item.text());

      expect(texts.some(t => t.includes('⟳'))).toBe(true); // Duplicate icon
      expect(texts.some(t => t.includes('📦'))).toBe(true); // Archive icon
      expect(texts.some(t => t.includes('🗑'))).toBe(true);  // Delete icon
    });

    it('highlights menu item on hover', async () => {
      const wrapper = mount(OverflowMenu);
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      await items[0].trigger('mouseenter');
      await wrapper.vm.$nextTick();

      expect(items[0].classes()).toContain('is-highlighted');
    });
  });

  describe('Accessibility Tests', () => {
    it('kebab button has aria-label', () => {
      const wrapper = mount(OverflowMenu);
      const button = wrapper.find('.btn-kebab');
      expect(button.attributes('aria-label')).toBe('More actions');
    });

    it('kebab button has custom aria-label when provided', () => {
      const wrapper = mount(OverflowMenu, {
        props: { ariaLabel: 'Session actions' }
      });
      const button = wrapper.find('.btn-kebab');
      expect(button.attributes('aria-label')).toBe('Session actions');
    });

    it('kebab button has aria-expanded attribute that toggles', async () => {
      const wrapper = mount(OverflowMenu);
      const button = wrapper.find('.btn-kebab');

      expect(button.attributes('aria-expanded')).toBe('false');

      await button.trigger('click');
      await wrapper.vm.$nextTick();
      expect(button.attributes('aria-expanded')).toBe('true');
    });

    it('kebab button has aria-haspopup="menu"', () => {
      const wrapper = mount(OverflowMenu);
      const button = wrapper.find('.btn-kebab');
      expect(button.attributes('aria-haspopup')).toBe('menu');
    });

    it('menu has role="menu"', async () => {
      const wrapper = mount(OverflowMenu);
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const menu = wrapper.find('.menu-items');
      expect(menu.attributes('role')).toBe('menu');
    });

    it('menu items have role="menuitem"', async () => {
      const wrapper = mount(OverflowMenu);
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      items.forEach((item) => {
        expect(item.attributes('role')).toBe('menuitem');
      });
    });
  });

  describe('Props Tests', () => {
    it('accepts custom text for Duplicate', async () => {
      const wrapper = mount(OverflowMenu, {
        props: { duplicateText: 'Copy Session' }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      expect(items.some(item => item.text().includes('Copy Session'))).toBe(true);
    });

    it('accepts custom text for Archive', async () => {
      const wrapper = mount(OverflowMenu, {
        props: { archiveText: 'Store' }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      expect(items.some(item => item.text().includes('Store'))).toBe(true);
    });

    it('accepts custom text for Delete', async () => {
      const wrapper = mount(OverflowMenu, {
        props: { deleteText: 'Remove' }
      });
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const items = wrapper.findAll('.menu-item');
      expect(items.some(item => item.text().includes('Remove'))).toBe(true);
    });
  });

  describe('Keyboard Navigation Tests', () => {
    it('supports arrow key navigation in menu', async () => {
      const wrapper = mount(OverflowMenu);
      await wrapper.find('.btn-kebab').trigger('click');
      await wrapper.vm.$nextTick();

      const menu = wrapper.find('.menu-items');
      expect(menu.exists()).toBe(true);

      await menu.trigger('keydown', { key: 'ArrowDown' });
      expect(wrapper.vm.highlightedIndex).not.toBeNull();
    });
  });
});
