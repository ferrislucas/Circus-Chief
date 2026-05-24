import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import {
  computeSessionOverlayKeyboardBottomInset,
  requestVisualViewportSettle,
  requestVisualViewportUpdate,
  setSessionOverlayPromptFocus,
  useVisualViewport,
  writeVisualViewportVariables,
  onVisualViewportChange,
} from './useVisualViewport.js';

describe('useVisualViewport', () => {
  let originalVisualViewport;
  let originalInnerWidth;
  let originalInnerHeight;
  let mockVisualViewport;
  let rafSpy;
  let cancelRafSpy;

  beforeEach(() => {
    originalVisualViewport = window.visualViewport;
    originalInnerWidth = window.innerWidth;
    originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 768 });
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => setTimeout(cb, 0));
    cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => clearTimeout(id));
    vi.spyOn(document.documentElement.style, 'setProperty');
  });

  afterEach(() => {
    if (originalVisualViewport) {
      window.visualViewport = originalVisualViewport;
    } else {
      delete window.visualViewport;
    }
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalInnerWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: originalInnerHeight });
    setSessionOverlayPromptFocus(false);
    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function createTestComponent() {
    return mount({
      template: '<div>Test</div>',
      setup() {
        const viewport = useVisualViewport();
        return viewport;
      },
    }, {
      attachTo: document.body,
    });
  }

  function setVisualViewport(offsetTop = 100, height = 700) {
    mockVisualViewport = {
      offsetTop,
      height,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    window.visualViewport = mockVisualViewport;
  }

  function expectViewportVariables(offsetTop, height) {
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--viewport-offset-top',
      offsetTop,
    );
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--visual-viewport-height',
      height,
    );
  }

  function expectKeyboardInset(value) {
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--session-overlay-keyboard-bottom-inset',
      value,
    );
  }

  describe('computeSessionOverlayKeyboardBottomInset', () => {
    const focusedIPad = {
      isOverlayPromptFocused: true,
      layoutWidth: 744,
      layoutHeight: 1000,
      visualViewportHeight: 700,
      visualViewportOffsetTop: 20,
      platform: 'MacIntel',
      maxTouchPoints: 5,
    };

    it('returns 0 when the overlay prompt is not focused', () => {
      expect(computeSessionOverlayKeyboardBottomInset({
        ...focusedIPad,
        isOverlayPromptFocused: false,
      })).toBe(0);
    });

    it('returns 0 for phone-class keyboard-shaped viewports', () => {
      expect(computeSessionOverlayKeyboardBottomInset({
        isOverlayPromptFocused: true,
        layoutWidth: 390,
        layoutHeight: 844,
        visualViewportHeight: 500,
        visualViewportOffsetTop: 0,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5,
      })).toBe(0);
    });

    it('returns 0 for non-touch tablet-sized layouts', () => {
      expect(computeSessionOverlayKeyboardBottomInset({
        ...focusedIPad,
        platform: 'Linux x86_64',
        maxTouchPoints: 0,
      })).toBe(0);
    });

    it('adds accessory allowance to the keyboard overlap on iPad-like touch devices', () => {
      expect(computeSessionOverlayKeyboardBottomInset(focusedIPad)).toBe(344);
    });

    it('clamps stale or extreme values to the configured maximum', () => {
      expect(computeSessionOverlayKeyboardBottomInset({
        ...focusedIPad,
        absoluteMax: 300,
      })).toBe(300);
    });
  });

  describe('CSS variable updates', () => {
    beforeEach(() => {
      setVisualViewport();
    });

    it('sets raw visual viewport variables on mount', async () => {
      const wrapper = createTestComponent();

      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      expectViewportVariables('100px', '700px');
      wrapper.unmount();
    });

    it('updates raw variables when visual viewport changes', async () => {
      const wrapper = createTestComponent();
      await nextTick();
      vi.mocked(document.documentElement.style.setProperty).mockClear();

      mockVisualViewport.offsetTop = 200;
      mockVisualViewport.height = 500;
      wrapper.vm.updateViewportOffset();
      await new Promise(resolve => setTimeout(resolve, 10));

      expectViewportVariables('200px', '500px');
      wrapper.unmount();
    });

    it('writes keyboard inset only from prompt focus state', () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 744 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 1000 });
      const originalPlatform = navigator.platform;
      const originalTouch = navigator.maxTouchPoints;
      Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
      mockVisualViewport.offsetTop = 20;
      mockVisualViewport.height = 600;

      setSessionOverlayPromptFocus(true);
      writeVisualViewportVariables();
      expectKeyboardInset('420px');

      setSessionOverlayPromptFocus(false);
      expectKeyboardInset('0px');
      Object.defineProperty(navigator, 'platform', { configurable: true, value: originalPlatform });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: originalTouch });
    });

    it('returns null without visualViewport support', () => {
      delete window.visualViewport;

      expect(writeVisualViewportVariables()).toBeNull();
    });
  });

  describe('subscriptions and settling', () => {
    beforeEach(() => {
      setVisualViewport(280, 420);
    });

    it('registers and removes visualViewport listeners', () => {
      const wrapper = createTestComponent();

      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));

      wrapper.unmount();

      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    });

    it('throttles explicit updates with requestAnimationFrame', async () => {
      const wrapper = createTestComponent();
      await new Promise(resolve => setTimeout(resolve, 10));
      rafSpy.mockClear();

      wrapper.vm.updateViewportOffset();
      wrapper.vm.updateViewportOffset();
      wrapper.vm.updateViewportOffset();

      expect(rafSpy).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it('continues sampling until delayed keyboard-dismiss viewport values arrive', async () => {
      requestVisualViewportSettle({
        maxDurationMs: 120,
        intervalMs: 10,
        stableSampleCount: 10,
        minDurationMs: 0,
      });

      setTimeout(() => {
        mockVisualViewport.offsetTop = 0;
        mockVisualViewport.height = 812;
      }, 25);

      await new Promise(resolve => setTimeout(resolve, 150));

      expectViewportVariables('280px', '420px');
      expectViewportVariables('0px', '812px');
      expect(document.documentElement.style.getPropertyValue('--viewport-offset-top')).toBe('0px');
      expect(document.documentElement.style.getPropertyValue('--visual-viewport-height')).toBe('812px');
    });

    it('settle and update no-op without visualViewport support', () => {
      delete window.visualViewport;

      requestVisualViewportSettle();
      requestVisualViewportUpdate();

      expect(rafSpy).not.toHaveBeenCalled();
    });

    it('onVisualViewportChange registers callbacks and returns cleanup', () => {
      const callback = vi.fn();
      const cleanup = onVisualViewportChange(callback);

      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith('scroll', callback);
      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith('resize', callback);

      cleanup();

      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith('scroll', callback);
      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith('resize', callback);
    });
  });
});
