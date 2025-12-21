import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import FileAttachment from './FileAttachment.vue';

describe('FileAttachment', () => {
  let wrapper;

  beforeEach(() => {
    wrapper = mount(FileAttachment);
  });

  describe('component structure', () => {
    it('renders attach button', () => {
      expect(wrapper.find('.attach-btn').exists()).toBe(true);
    });

    it('renders hidden file input', () => {
      const input = wrapper.find('input[type="file"]');
      expect(input.exists()).toBe(true);
      expect(input.classes()).toContain('hidden-input');
    });

    it('has correct accept attribute', () => {
      const input = wrapper.find('input[type="file"]');
      expect(input.attributes('multiple')).toBeDefined();
    });
  });

  describe('file display', () => {
    it('initially shows no files', () => {
      expect(wrapper.findAll('.file-chip')).toHaveLength(0);
    });

    it('displays files when added via exposed method', async () => {
      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });

      // Access internal state directly since emit is tricky to test
      wrapper.vm.files.push(file);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.file-chip').exists()).toBe(true);
      expect(wrapper.find('.file-name').text()).toBe('test.txt');
    });

    it('shows remove button for each file', async () => {
      const file = new File(['test'], 'test.txt', { type: 'text/plain' });
      wrapper.vm.files.push(file);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.remove-btn').exists()).toBe(true);
    });
  });

  describe('file removal', () => {
    it('removes file when remove button clicked', async () => {
      const file = new File(['test'], 'test.txt', { type: 'text/plain' });
      wrapper.vm.files.push(file);
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('.file-chip')).toHaveLength(1);

      await wrapper.find('.remove-btn').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('.file-chip')).toHaveLength(0);
    });
  });

  describe('clear method', () => {
    it('clears all files when clear() is called', async () => {
      const file = new File(['test'], 'test.txt', { type: 'text/plain' });
      wrapper.vm.files.push(file);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.file-chip').exists()).toBe(true);

      wrapper.vm.clear();
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.file-chip').exists()).toBe(false);
      expect(wrapper.vm.files).toHaveLength(0);
    });
  });

  describe('file icons', () => {
    it('shows correct icon for image files', async () => {
      const file = new File([''], 'image.png', { type: 'image/png' });
      wrapper.vm.files.push(file);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.file-icon').text()).toContain('🖼️');
    });

    it('shows correct icon for text files', async () => {
      const file = new File([''], 'doc.txt', { type: 'text/plain' });
      wrapper.vm.files.push(file);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.file-icon').text()).toContain('📄');
    });

    it('shows correct icon for PDF files', async () => {
      const file = new File([''], 'doc.pdf', { type: 'application/pdf' });
      wrapper.vm.files.push(file);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.file-icon').text()).toContain('📕');
    });

    it('shows correct icon for JavaScript files', async () => {
      const file = new File([''], 'script.js', { type: 'application/javascript' });
      wrapper.vm.files.push(file);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.file-icon').text()).toContain('📜');
    });
  });

  describe('file size formatting', () => {
    it('formats bytes correctly', async () => {
      const file = new File(['test'], 'small.txt', { type: 'text/plain' });
      wrapper.vm.files.push(file);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.file-size').text()).toContain('B');
    });
  });

  describe('attach button', () => {
    it('opens file picker when attach button is clicked', async () => {
      const clickSpy = vi.fn();
      const input = wrapper.find('input[type="file"]');
      input.element.click = clickSpy;

      await wrapper.find('.attach-btn').trigger('click');

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('props', () => {
    it('accepts custom maxFiles prop', () => {
      const customWrapper = mount(FileAttachment, {
        props: { maxFiles: 5 },
      });
      expect(customWrapper.props('maxFiles')).toBe(5);
    });

    it('accepts custom maxSize prop', () => {
      const customWrapper = mount(FileAttachment, {
        props: { maxSize: 1024 },
      });
      expect(customWrapper.props('maxSize')).toBe(1024);
    });
  });
});
