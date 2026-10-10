import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, ref, nextTick } from 'vue';
import { useWorkLogFollow } from './useWorkLogFollow.js';

/**
 * Regression coverage for PR Review Issue 2 (P2): follow retries must not
 * mistake a successful scroll for stable content height, and content-only
 * growth past the capped outer box must re-pin through a content-size
 * notification — even after the retry window has ended.
 *
 * Geometry is realistic: scrollTop assignments clamp the way a real scroll
 * container clamps, the outer clientHeight stays constant while inner
 * content grows, and animation frames are fully controllable. No fabricated
 * outer ResizeObserver notification is fired for content-only growth.
 */

// --- Controllable animation frames -------------------------------------

let rafQueue;
let rafCalls;
let cancelCalls;

function installFrameStubs() {
  rafQueue = [];
  rafCalls = 0;
  cancelCalls = 0;
  let nextId = 1;
  const ids = new Map();
  globalThis.requestAnimationFrame = (cb) => {
    const id = nextId++;
    rafCalls += 1;
    rafQueue.push({ id, cb });
    ids.set(id, cb);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    cancelCalls += 1;
    rafQueue = rafQueue.filter((entry) => entry.id !== id);
    ids.delete(id);
  };
}

// --- ResizeObserver mock that records which element is observed --------

let roInstances;

function installObserverMock() {
  roInstances = [];
  globalThis.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb;
      this.targets = [];
      this.disconnected = false;
      roInstances.push(this);
    }

    observe(target) {
      this.targets.push(target);
    }

    unobserve(target) {
      this.targets = this.targets.filter((t) => t !== target);
    }

    disconnect() {
      this.disconnected = true;
    }
  };
}

function liveCallbacksFor(el) {
  return roInstances
    .filter((instance) => !instance.disconnected && instance.targets.includes(el))
    .map((instance) => instance.cb);
}

// --- Realistic clamped scroll geometry ---------------------------------

function makeScrollable({ scrollHeight = 500, clientHeight = 250 } = {}) {
  const el = document.createElement('div');
  let currentHeight = scrollHeight;
  let currentTop = 0;
  Object.defineProperty(el, 'scrollHeight', {
    get: () => currentHeight,
    configurable: true,
  });
  Object.defineProperty(el, 'clientHeight', {
    get: () => clientHeight,
    configurable: true,
  });
  Object.defineProperty(el, 'scrollTop', {
    get: () => currentTop,
    // Real containers clamp programmatic assignments into range.
    set: (value) => {
      currentTop = Math.max(0, Math.min(value, currentHeight - clientHeight));
    },
    configurable: true,
  });
  return {
    el,
    setScrollHeight(value) {
      currentHeight = value;
      // Growing keeps the viewport where it is; shrinking clamps it.
      currentTop = Math.max(0, Math.min(currentTop, currentHeight - clientHeight));
    },
  };
}

const Harness = defineComponent({
  name: 'FollowHarness',
  props: {
    isActive: { type: Boolean, default: true },
  },
  setup(props, { expose }) {
    const containerRef = ref(null);
    const contentRef = ref(null);
    const follow = useWorkLogFollow({
      resolveContainer: () => containerRef.value,
      resolveContent: () => contentRef.value,
      isActive: () => props.isActive,
    });
    expose({ ...follow, containerRef, contentRef });
    return () => null;
  },
});

async function mountFollowing({ isActive = true } = {}) {
  const container = makeScrollable();
  const content = document.createElement('div');
  const wrapper = mount(Harness, { props: { isActive } });
  wrapper.vm.containerRef = container.el;
  wrapper.vm.contentRef = content;
  await flushPromises();
  await nextTick();
  return { wrapper, container, content };
}

function pinToBottom(wrapper, scrollable) {
  const { el } = scrollable;
  el.scrollTop = el.scrollHeight;
  wrapper.vm.handleScroll({ target: el });
}

/** Run one generation of queued frames, flushing the ticks they schedule. */
async function runFrameGeneration() {
  const pending = rafQueue.splice(0, rafQueue.length);
  for (const { cb } of pending) cb();
  await flushPromises();
  await nextTick();
  await flushPromises();
}

async function settleChain({ maxGenerations = 80 } = {}) {
  for (let i = 0; i < maxGenerations && rafQueue.length > 0; i++) {
    await runFrameGeneration();
  }
}

function bottomOf(container) {
  return container.el.scrollHeight - container.el.clientHeight;
}

describe('useWorkLogFollow content-growth regression (Issue 2)', () => {
  let OriginalRAF;
  let OriginalCancelRAF;
  let OriginalRO;

  beforeEach(() => {
    OriginalRAF = globalThis.requestAnimationFrame;
    OriginalCancelRAF = globalThis.cancelAnimationFrame;
    OriginalRO = globalThis.ResizeObserver;
    installFrameStubs();
    installObserverMock();
  });

  afterEach(() => {
    if (OriginalRAF === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = OriginalRAF;
    if (OriginalCancelRAF === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = OriginalCancelRAF;
    if (OriginalRO === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = OriginalRO;
  });

  it('keeps pinning while content height changes on more than five successive frames', async () => {
    const { wrapper, container } = await mountFollowing();
    pinToBottom(wrapper, container);
    expect(wrapper.vm.isNearBottom).toBe(true);

    wrapper.vm.scrollToBottom();
    await flushPromises();
    await nextTick();

    // Outer box stays capped; inner content grows on every frame, well past
    // the old five-frame "settled" streak. A pin that lands at distance zero
    // is not evidence of stability — retries must keep going.
    for (let frame = 0; frame < 8; frame++) {
      container.setScrollHeight(container.el.scrollHeight + 60);
      await runFrameGeneration();
      expect(container.el.scrollTop).toBe(bottomOf(container));
    }
    // Still changing, so the retry budget must still be alive.
    expect(rafQueue.length).toBeGreaterThan(0);
    expect(rafCalls).toBeGreaterThan(8);

    // Growth stops: the chain must converge instead of polling forever.
    await settleChain();
    expect(rafQueue.length).toBe(0);
    expect(container.el.scrollTop).toBe(bottomOf(container));
    wrapper.unmount();
  });

  it('re-pins content-only growth after the retry window via content observation', async () => {
    const { wrapper, container, content } = await mountFollowing();
    pinToBottom(wrapper, container);

    wrapper.vm.scrollToBottom();
    await flushPromises();
    await nextTick();
    await settleChain();
    expect(rafQueue.length).toBe(0);

    // The inner content element — not the capped outer box — must be
    // observed, because only its size changes on content-only growth.
    expect(liveCallbacksFor(content).length).toBeGreaterThan(0);

    // Late growth arrives with no new log and no outer-box resize.
    const outerHeight = container.el.clientHeight;
    container.setScrollHeight(container.el.scrollHeight + 200);
    expect(container.el.clientHeight).toBe(outerHeight);
    for (const cb of liveCallbacksFor(content)) cb();
    await flushPromises();
    await nextTick();
    await settleChain();

    expect(container.el.scrollTop).toBe(bottomOf(container));
    wrapper.unmount();
  });

  it('stays paused through delayed growth after scroll-up, then follows on return', async () => {
    const { wrapper, container, content } = await mountFollowing();
    pinToBottom(wrapper, container);
    expect(wrapper.vm.isNearBottom).toBe(true);

    // User scrolls up: delayed growth must not yank the viewport.
    container.el.scrollTop = 0;
    wrapper.vm.handleScroll({ target: container.el });
    expect(wrapper.vm.isNearBottom).toBe(false);

    container.setScrollHeight(container.el.scrollHeight + 200);
    for (const cb of liveCallbacksFor(content)) cb();
    await flushPromises();
    await nextTick();
    await settleChain();
    expect(container.el.scrollTop).toBe(0);

    // Scrolling back within the threshold re-arms follow for later growth.
    pinToBottom(wrapper, container);
    expect(wrapper.vm.isNearBottom).toBe(true);
    container.setScrollHeight(container.el.scrollHeight + 120);
    for (const cb of liveCallbacksFor(content)) cb();
    await flushPromises();
    await nextTick();
    await settleChain();
    expect(container.el.scrollTop).toBe(bottomOf(container));
    wrapper.unmount();
  });

  it('coalesces concurrent follow triggers into one pending frame sequence', async () => {
    const { wrapper } = await mountFollowing();
    wrapper.vm.scrollToBottom();
    wrapper.vm.scrollToBottom();
    wrapper.vm.scrollToBottom();
    await flushPromises();
    await nextTick();
    expect(rafQueue.length).toBe(1);
    wrapper.unmount();
  });

  it('cancels pending frames on unmount without scrolling afterwards', async () => {
    const { wrapper, container } = await mountFollowing();
    pinToBottom(wrapper, container);
    wrapper.vm.scrollToBottom();
    await flushPromises();
    await nextTick();
    expect(rafQueue.length).toBeGreaterThan(0);

    container.el.scrollTop = 0;
    wrapper.unmount();
    expect(cancelCalls).toBeGreaterThan(0);
    await settleChain();
    await flushPromises();
    expect(container.el.scrollTop).toBe(0);
  });

  it('rebinds observers on element replacement without scrolling the detached panel', async () => {
    const { wrapper, container, content } = await mountFollowing();
    pinToBottom(wrapper, container);
    wrapper.vm.scrollToBottom();
    await flushPromises();
    await nextTick();
    expect(liveCallbacksFor(container.el).length).toBeGreaterThan(0);

    const replacement = makeScrollable();
    const replacementContent = document.createElement('div');
    const staleTop = container.el.scrollTop;
    container.el.scrollTop = 0;
    wrapper.vm.containerRef = replacement.el;
    wrapper.vm.contentRef = replacementContent;
    await flushPromises();
    await nextTick();

    expect(liveCallbacksFor(replacement.el).length).toBeGreaterThan(0);
    expect(liveCallbacksFor(replacementContent).length).toBeGreaterThan(0);

    // Stale queued work must not scroll the detached panel back down.
    await settleChain();
    await flushPromises();
    expect(container.el.scrollTop).toBe(0);
    expect(staleTop).toBeGreaterThan(0);
    wrapper.unmount();
  });
});
