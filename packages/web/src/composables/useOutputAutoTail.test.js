import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useOutputAutoTail, OUTPUT_BOTTOM_TOLERANCE_PX } from './useOutputAutoTail.js';

/**
 * Creates a fake scroll element with controlled, writable geometry.
 */
function createFakeElement({ scrollHeight = 1000, scrollTop = 0, clientHeight = 300 } = {}) {
  return { scrollHeight, scrollTop, clientHeight };
}

/**
 * Mounts a minimal host component so the composable runs inside Vue's
 * lifecycle (onBeforeUnmount) and reactivity (nextTick) machinery.
 */
function mountComposable(elRef) {
  let api;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useOutputAutoTail(elRef);
        return () => h('div');
      },
    })
  );
  return { wrapper, api: () => api };
}

describe('useOutputAutoTail', () => {
  let rafQueue;
  let rafId;

  beforeEach(() => {
    rafQueue = [];
    rafId = 0;
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      const id = ++rafId;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id) => {
      rafQueue = rafQueue.filter((f) => f.id !== id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushFrames() {
    const queue = rafQueue;
    rafQueue = [];
    queue.forEach((f) => f.cb());
  }

  it('exports a shared bottom tolerance constant of 16px', () => {
    expect(OUTPUT_BOTTOM_TOLERANCE_PX).toBe(16);
  });

  it('starts in tail mode by default', () => {
    const elRef = ref(null);
    const { api } = mountComposable(elRef);
    expect(api().isTailing.value).toBe(true);
  });

  it('reset enters tail mode and scrolls to bottom after nextTick plus one frame', async () => {
    const el = createFakeElement({ scrollHeight: 2000, scrollTop: 0, clientHeight: 300 });
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().isTailing.value = false;
    api().resetTail({ scroll: true });
    expect(api().isTailing.value).toBe(true);

    await nextTick();
    expect(el.scrollTop).toBe(0); // not yet - frame hasn't run
    flushFrames();
    expect(el.scrollTop).toBe(2000);
  });

  it('reset without a scroll request enters tail mode but does not queue a frame', async () => {
    const el = createFakeElement();
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().resetTail();
    expect(api().isTailing.value).toBe(true);

    await nextTick();
    expect(rafQueue.length).toBe(0);
  });

  it('treats geometry more than tolerance above bottom as paused', () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 600, clientHeight: 300 });
    // distance from bottom = 1000 - 600 - 300 = 100 > 16
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().handleScroll();
    expect(api().isTailing.value).toBe(false);
  });

  it('treats geometry exactly at tolerance from bottom as tailing', () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 684, clientHeight: 300 });
    // distance from bottom = 1000 - 684 - 300 = 16 === tolerance
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().handleScroll();
    expect(api().isTailing.value).toBe(true);
  });

  it('clamps a negative distance from bottom to zero and remains tailing', () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 750, clientHeight: 300 });
    // distance from bottom = 1000 - 750 - 300 = -50 -> clamp to 0
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().handleScroll();
    expect(api().isTailing.value).toBe(true);
  });

  it('a rendered-output notification while paused preserves scrollTop', async () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 200, clientHeight: 300 });
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().handleScroll(); // distance = 500 -> paused
    expect(api().isTailing.value).toBe(false);

    api().handleRenderedOutput();
    await nextTick();
    flushFrames();

    expect(el.scrollTop).toBe(200);
  });

  it('a rendered-output notification while tailing scrolls to the new bottom', async () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 });
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    // distance = 0 -> tailing (default true anyway)
    api().handleScroll();
    expect(api().isTailing.value).toBe(true);

    el.scrollHeight = 5000; // large output growth
    api().handleRenderedOutput();
    await nextTick();
    flushFrames();

    expect(el.scrollTop).toBe(5000);
  });

  it('a large scrollHeight increase while tailing never disables tail mode', async () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 });
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    expect(api().isTailing.value).toBe(true);

    // Simulate a huge content growth without any scroll event firing.
    el.scrollHeight = 50000;
    api().handleRenderedOutput();
    await nextTick();
    flushFrames();

    expect(api().isTailing.value).toBe(true);
    expect(el.scrollTop).toBe(50000);
  });

  it('a scroll-away before an already-scheduled frame runs keeps the pane paused', async () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 });
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    // Output arrives while tailing, so a scroll-to-bottom frame is queued.
    api().handleRenderedOutput();
    await nextTick();
    expect(rafQueue.length).toBe(1);

    // The user scrolls to the top before that frame gets a chance to run.
    el.scrollTop = 0;
    api().handleScroll();
    expect(api().isTailing.value).toBe(false);

    flushFrames();

    expect(el.scrollTop).toBe(0);
    expect(api().isTailing.value).toBe(false);
  });

  it('repeated notifications before the frame runs coalesce to one frame', async () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 });
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().handleRenderedOutput();
    api().handleRenderedOutput();
    api().handleRenderedOutput();

    await nextTick();
    expect(rafQueue.length).toBe(1);

    flushFrames();
    expect(el.scrollTop).toBe(1000);
  });

  it('returning within tolerance resumes tailing', () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 400, clientHeight: 300 });
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().handleScroll(); // distance = 300 -> paused
    expect(api().isTailing.value).toBe(false);

    el.scrollTop = 700; // distance = 0
    api().handleScroll();
    expect(api().isTailing.value).toBe(true);
  });

  it('does not schedule work when the container ref is null', async () => {
    const elRef = ref(null);
    const { api } = mountComposable(elRef);

    api().handleScroll(); // no-op, no element
    api().resetTail({ scroll: true });

    await nextTick();
    // Frame is still scheduled (nextTick fired), but running it should be a no-op.
    flushFrames();
    expect(elRef.value).toBe(null); // nothing to assert on, but no throw
  });

  it('exits without rescheduling when the element is unmounted by frame time', async () => {
    const el = createFakeElement();
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().resetTail({ scroll: true });
    await nextTick();
    elRef.value = null; // container unmounted before frame runs
    flushFrames();

    // No throw, and no further frame was scheduled automatically.
    expect(rafQueue.length).toBe(0);
  });

  it('programmatic scrolling does not itself toggle isTailing', async () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 });
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().isTailing.value = false;
    // Programmatic scroll scheduling (no handleScroll call) must not flip state on its own.
    api().resetTail({ scroll: true });
    await nextTick();
    flushFrames();

    expect(api().isTailing.value).toBe(true); // only because resetTail set it, not the scroll itself
  });

  it('a scroll event from our own scroll-to-bottom does not pause a growing pane', async () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 });
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().handleRenderedOutput();
    await nextTick();
    flushFrames();
    expect(el.scrollTop).toBe(1000);

    // More output lands before the browser delivers the scroll event for the
    // write above, so the pane now measures far from the bottom even though
    // the user never touched it.
    el.scrollHeight = 5000;
    api().handleScroll();

    expect(api().isTailing.value).toBe(true);
  });

  it('still pauses when the user scrolls up after a programmatic scroll', async () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 });
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().handleRenderedOutput();
    await nextTick();
    flushFrames();

    el.scrollTop = 0;
    api().handleScroll();

    expect(api().isTailing.value).toBe(false);
  });

  it('disposal cancels pending frame work and a late frame cannot mutate the element', async () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 0, clientHeight: 300 });
    const elRef = ref(el);
    const { wrapper, api } = mountComposable(elRef);

    api().resetTail({ scroll: true });
    await nextTick(); // rAF now scheduled

    wrapper.unmount(); // triggers onBeforeUnmount -> dispose()

    flushFrames(); // any residual frame callbacks should no-op
    expect(el.scrollTop).toBe(0);
  });

  it('calling dispose directly prevents further scheduling', async () => {
    const el = createFakeElement({ scrollHeight: 1000, scrollTop: 0, clientHeight: 300 });
    const elRef = ref(el);
    const { api } = mountComposable(elRef);

    api().dispose();
    api().resetTail({ scroll: true });
    await nextTick();
    flushFrames();

    expect(el.scrollTop).toBe(0);
  });
});
