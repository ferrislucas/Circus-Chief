import { onMounted, onUnmounted, ref, watch } from 'vue';

/** Reports whether an element is in (or near) the viewport. */
export function useElementVisibility(element, { rootMargin = '200px 0px' } = {}) {
  const isVisible = ref(true);
  let observer;

  function observe() {
    observer?.disconnect();
    const target = element.value;
    if (!target || typeof IntersectionObserver === 'undefined') {
      isVisible.value = true;
      return;
    }
    observer = new IntersectionObserver(([entry]) => {
      isVisible.value = entry.isIntersecting;
    }, { rootMargin });
    observer.observe(target);
  }

  onMounted(observe);
  watch(element, observe);
  onUnmounted(() => observer?.disconnect());
  return { isVisible };
}
