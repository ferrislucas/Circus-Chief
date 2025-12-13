import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUiStore } from './ui.js';

describe('UI Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('adds a toast', () => {
    const store = useUiStore();
    const id = store.addToast('success', 'Test message', 0);

    expect(store.toasts.length).toBe(1);
    expect(store.toasts[0].id).toBe(id);
    expect(store.toasts[0].type).toBe('success');
    expect(store.toasts[0].message).toBe('Test message');
  });

  it('removes a toast', () => {
    const store = useUiStore();
    const id = store.addToast('info', 'Test', 0);
    store.removeToast(id);

    expect(store.toasts.length).toBe(0);
  });

  it('has convenience methods', () => {
    const store = useUiStore();

    store.success('Success');
    store.error('Error');
    store.warning('Warning');
    store.info('Info');

    expect(store.toasts.length).toBe(4);
    expect(store.toasts[0].type).toBe('success');
    expect(store.toasts[1].type).toBe('error');
    expect(store.toasts[2].type).toBe('warning');
    expect(store.toasts[3].type).toBe('info');
  });

  it('opens and closes modal', () => {
    const store = useUiStore();

    store.openModal('test-modal');
    expect(store.modalOpen).toBe('test-modal');

    store.closeModal();
    expect(store.modalOpen).toBeNull();
  });

  it('sets loading state', () => {
    const store = useUiStore();

    store.setLoading(true);
    expect(store.loading).toBe(true);

    store.setLoading(false);
    expect(store.loading).toBe(false);
  });
});
