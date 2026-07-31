import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { useElementVisibility } from './useElementVisibility.js';

describe('useElementVisibility', () => {
  let element;
  let isVisible;
  let wrapper;

  beforeEach(() => {
    element = ref(null);
    const Component = {
      template: '<div ref="target" />',
      setup() {
        const target = element;
        ({ isVisible } = useElementVisibility(target));
        return { target };
      },
    };
    wrapper = mount(Component);
  });

  it('observes on mount and reports observer visibility changes', async () => {
    await nextTick();
    const observer = IntersectionObserver.instances.at(-1);
    expect(observer.targets.has(element.value)).toBe(true);
    expect(isVisible.value).toBe(true);

    observer.trigger(false);
    expect(isVisible.value).toBe(false);
    observer.trigger(true);
    expect(isVisible.value).toBe(true);
  });

  it('uses the default root margin and disconnects on unmount', async () => {
    await nextTick();
    const observer = IntersectionObserver.instances.at(-1);
    expect(observer.options).toEqual({ rootMargin: '200px 0px' });

    wrapper.unmount();
    expect(observer.targets.size).toBe(0);
  });

  it('honors a custom root margin', async () => {
    let customVisible;
    const Component = {
      template: '<div ref="target" />',
      setup() {
        const target = ref(null);
        ({ isVisible: customVisible } = useElementVisibility(target, { rootMargin: '20px' }));
        return { target };
      },
    };
    const customWrapper = mount(Component);
    await nextTick();
    expect(customVisible.value).toBe(true);
    expect(IntersectionObserver.instances.at(-1).options).toEqual({ rootMargin: '20px' });
    customWrapper.unmount();
  });

  it('re-observes a replacement element after disconnecting the previous observer', async () => {
    await nextTick();
    const firstObserver = IntersectionObserver.instances.at(-1);
    const replacement = document.createElement('div');
    element.value = replacement;
    await nextTick();

    expect(firstObserver.targets.size).toBe(0);
    expect(IntersectionObserver.instances.at(-1).targets.has(replacement)).toBe(true);
  });

  it('degrades safely when IntersectionObserver is unavailable', async () => {
    wrapper.unmount();
    const original = globalThis.IntersectionObserver;
    delete globalThis.IntersectionObserver;
    const target = ref(null);
    let fallbackVisible;
    const fallback = mount({
      template: '<div ref="target" />',
      setup() {
        ({ isVisible: fallbackVisible } = useElementVisibility(target));
        return { target };
      },
    });
    await nextTick();
    expect(fallbackVisible.value).toBe(true);
    expect(globalThis.IntersectionObserver).toBeUndefined();
    fallback.unmount();
    globalThis.IntersectionObserver = original;
  });
});
