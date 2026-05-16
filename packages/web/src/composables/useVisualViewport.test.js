import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import {
  computeSessionOverlayTopChromeInset,
  requestVisualViewportSettle,
  requestVisualViewportUpdate,
  useVisualViewport,
  writeVisualViewportVariables,
} from './useVisualViewport.js';

/**
 * Tests for useVisualViewport composable
 *
 * This composable tracks the visual viewport offset and updates CSS variables
 * for iOS Safari browser chrome (URL bar, tab bar) that can overlap sticky elements.
 *
 * See: https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API
 */
describe('useVisualViewport', () => {
  let originalVisualViewport;
  let mockVisualViewport;
  let rafSpy;
  let cancelRafSpy;
  let originalInnerWidth;
  let originalInnerHeight;

  beforeEach(() => {
    // Save original visualViewport
    originalVisualViewport = window.visualViewport;
    originalInnerWidth = window.innerWidth;
    originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1024,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 768,
    });

    // Mock requestAnimationFrame and cancelAnimationFrame
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => setTimeout(cb, 0));

    cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      clearTimeout(id);
    });

    // Mock document.documentElement.style.setProperty
    vi.spyOn(document.documentElement.style, 'setProperty');
  });

  afterEach(() => {
    // Restore visualViewport
    if (originalVisualViewport) {
      window.visualViewport = originalVisualViewport;
    } else {
      delete window.visualViewport;
    }
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });

    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
    vi.restoreAllMocks();
  });

  /**
   * Helper component that uses the composable
   */
  function createTestComponent() {
    const TestComponent = {
      template: '<div>Test</div>',
      setup() {
        const {
          requestVisualViewportSettle: requestVisualViewportSettleFn,
          requestVisualViewportUpdate: requestVisualViewportUpdateFn,
          updateViewportOffset,
        } = useVisualViewport();
        return {
          requestVisualViewportSettle: requestVisualViewportSettleFn,
          requestVisualViewportUpdate: requestVisualViewportUpdateFn,
          updateViewportOffset,
        };
      },
    };

    return mount(TestComponent, {
      attachTo: document.body,
    });
  }

  function expectViewportVariables(offsetTop, height, sessionOverlayTopChromeInset = '0px') {
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--viewport-offset-top',
      offsetTop
    );
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--visual-viewport-height',
      height
    );
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--session-overlay-top-chrome-inset',
      sessionOverlayTopChromeInset
    );
  }

  function setLayoutViewport(width, height) {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: width,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: height,
    });
  }

  describe('computeSessionOverlayTopChromeInset', () => {
    it('returns 0 for an iPhone 12 mini keyboard-shaped viewport', () => {
      expect(
        computeSessionOverlayTopChromeInset({
          offsetTop: 260,
          visualViewportHeight: 420,
          layoutWidth: 375,
          layoutHeight: 812,
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          platform: 'iPhone',
        })
      ).toBe(0);
    });

    it('returns 0 for iPhone-like devices even with a small offset', () => {
      expect(
        computeSessionOverlayTopChromeInset({
          offsetTop: 32,
          visualViewportHeight: 780,
          layoutWidth: 375,
          layoutHeight: 812,
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          platform: 'iPhone',
        })
      ).toBe(0);
    });

    it('returns the offset for iPad user-agent and iPadOS touch-platform signals', () => {
      const base = {
        offsetTop: 32,
        visualViewportHeight: 968,
        layoutWidth: 744,
        layoutHeight: 1000,
      };

      expect(
        computeSessionOverlayTopChromeInset({
          ...base,
          userAgent:
            'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          platform: 'iPad',
        })
      ).toBe(32);
      expect(
        computeSessionOverlayTopChromeInset({
          ...base,
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
          platform: 'MacIntel',
          maxTouchPoints: 5,
        })
      ).toBe(32);
    });

    it('returns 0 for an iPad signal with a keyboard-shaped viewport', () => {
      expect(
        computeSessionOverlayTopChromeInset({
          offsetTop: 32,
          visualViewportHeight: 600,
          layoutWidth: 744,
          layoutHeight: 1000,
          userAgent:
            'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          platform: 'iPad',
        })
      ).toBe(0);
    });

    it('keeps Android Mobile at 0 and allows Android tablet offsets', () => {
      expect(
        computeSessionOverlayTopChromeInset({
          offsetTop: 32,
          visualViewportHeight: 812,
          layoutWidth: 412,
          layoutHeight: 915,
          userAgent:
            'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36',
        })
      ).toBe(0);

      expect(
        computeSessionOverlayTopChromeInset({
          offsetTop: 32,
          visualViewportHeight: 968,
          layoutWidth: 800,
          layoutHeight: 1000,
          userAgent:
            'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Safari/537.36',
        })
      ).toBe(32);
    });

    it.each([
      [Number.NaN],
      [Infinity],
      [-1],
      [0],
      [65],
    ])('returns 0 for invalid or over-threshold offset %s', (offsetTop) => {
      expect(
        computeSessionOverlayTopChromeInset({
          offsetTop,
          visualViewportHeight: 968,
          layoutWidth: 744,
          layoutHeight: 1000,
          platform: 'iPad',
        })
      ).toBe(0);
    });

    it('returns the offset for a tablet-sized layout without a phone signal', () => {
      expect(
        computeSessionOverlayTopChromeInset({
          offsetTop: 32,
          visualViewportHeight: 968,
          layoutWidth: 744,
          layoutHeight: 1000,
          userAgent:
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          platform: 'Linux x86_64',
        })
      ).toBe(32);
    });
  });

  describe('Browser support detection', () => {
    it('returns without errors when visualViewport API is not supported', () => {
      // Remove visualViewport to simulate unsupported browser
      delete window.visualViewport;

      const wrapper = createTestComponent();
      expect(wrapper.exists()).toBe(true);

      wrapper.unmount();
    });

    it('does not set CSS variable when visualViewport API is not supported', () => {
      delete window.visualViewport;

      createTestComponent();

      expect(document.documentElement.style.setProperty).not.toHaveBeenCalled();
    });
  });

  describe('CSS variable updates', () => {
    beforeEach(() => {
      // Mock visualViewport API
      mockVisualViewport = {
        offsetTop: 100,
        height: 700,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;
    });

    it('sets --viewport-offset-top CSS variable on mount', async () => {
      createTestComponent();

      // Wait for RAF to execute
      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      expectViewportVariables('100px', '700px');
    });

    it('updates CSS variables when visual viewport changes', async () => {
      const wrapper = createTestComponent();

      await nextTick();

      // Clear previous calls
      vi.mocked(document.documentElement.style.setProperty).mockClear();

      // Simulate offsetTop change
      mockVisualViewport.offsetTop = 200;
      mockVisualViewport.height = 500;

      // Call updateViewportOffset directly
      wrapper.vm.updateViewportOffset();

      // Wait for requestAnimationFrame to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expectViewportVariables('200px', '500px');

      wrapper.unmount();
    });

    it('handles offsetTop of 0', async () => {
      mockVisualViewport.offsetTop = 0;
      mockVisualViewport.height = 0;

      createTestComponent();

      // Wait for RAF to execute
      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      expectViewportVariables('0px', '0px');
    });

    it('writes raw viewport variables and the sanitized overlay inset', () => {
      setLayoutViewport(744, 1000);
      mockVisualViewport.offsetTop = 32;
      mockVisualViewport.height = 968;

      const rect = writeVisualViewportVariables();

      expect(rect).toEqual({ offsetTop: 32, height: 968 });
      expectViewportVariables('32px', '968px', '32px');
    });
  });

  describe('Event listeners', () => {
    beforeEach(() => {
      mockVisualViewport = {
        offsetTop: 50,
        height: 600,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;
    });

    it('registers scroll event listener on mount', () => {
      createTestComponent();

      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith(
        'scroll',
        expect.any(Function)
      );
    });

    it('registers resize event listener on mount', () => {
      createTestComponent();

      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith(
        'resize',
        expect.any(Function)
      );
    });

    it('removes event listeners on unmount', () => {
      const wrapper = createTestComponent();

      wrapper.unmount();

      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith(
        'scroll',
        expect.any(Function)
      );
      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith(
        'resize',
        expect.any(Function)
      );
    });
  });

  describe('Viewport change handling', () => {
    beforeEach(() => {
      let scrollHandler = null;
      let resizeHandler = null;

      mockVisualViewport = {
        offsetTop: 0,
        height: 700,
        addEventListener: vi.fn((event, handler) => {
          if (event === 'scroll') scrollHandler = handler;
          if (event === 'resize') resizeHandler = handler;
        }),
        removeEventListener: vi.fn((event, handler) => {
          if (event === 'scroll' && handler === scrollHandler) scrollHandler = null;
          if (event === 'resize' && handler === resizeHandler) resizeHandler = null;
        }),
      };
      window.visualViewport = mockVisualViewport;
    });

    it('updates CSS variable on scroll event', async () => {
      const wrapper = createTestComponent();

      await nextTick();

      // Clear initial call
      vi.mocked(document.documentElement.style.setProperty).mockClear();

      // Get the scroll handler
      const scrollHandler = mockVisualViewport.addEventListener.mock.calls.find(
        call => call[0] === 'scroll'
      )[1];

      // Simulate scroll event with new offset
      mockVisualViewport.offsetTop = 150;
      mockVisualViewport.height = 450;
      scrollHandler();

      // Wait for requestAnimationFrame
      await new Promise(resolve => setTimeout(resolve, 10));

      expectViewportVariables('150px', '450px');

      wrapper.unmount();
    });

    it('updates CSS variable on resize event', async () => {
      const wrapper = createTestComponent();

      await nextTick();

      // Clear initial call
      vi.mocked(document.documentElement.style.setProperty).mockClear();

      // Get the resize handler
      const resizeHandler = mockVisualViewport.addEventListener.mock.calls.find(
        call => call[0] === 'resize'
      )[1];

      // Simulate resize event with new offset
      mockVisualViewport.offsetTop = 80;
      mockVisualViewport.height = 550;
      resizeHandler();

      // Wait for requestAnimationFrame
      await new Promise(resolve => setTimeout(resolve, 10));

      expectViewportVariables('80px', '550px');

      wrapper.unmount();
    });
  });

  describe('RequestAnimationFrame throttling', () => {
    beforeEach(() => {
      mockVisualViewport = {
        offsetTop: 0,
        height: 700,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;
    });

    it('throttles updates using requestAnimationFrame', async () => {
      const wrapper = createTestComponent();

      // Wait for initial mount RAF
      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      // Clear initial call
      vi.mocked(document.documentElement.style.setProperty).mockClear();
      rafSpy.mockClear();

      // Call updateViewportOffset multiple times rapidly
      wrapper.vm.updateViewportOffset();
      wrapper.vm.updateViewportOffset();
      wrapper.vm.updateViewportOffset();

      // Each call should trigger RAF
      expect(rafSpy).toHaveBeenCalled();

      wrapper.unmount();
    });

    it('cancels pending RAF on unmount', () => {
      const wrapper = createTestComponent();

      // Trigger an update (will schedule a RAF)
      wrapper.vm.updateViewportOffset();

      expect(rafSpy).toHaveBeenCalled();

      wrapper.unmount();

      expect(cancelRafSpy).toHaveBeenCalled();
    });
  });

  describe('Viewport settling', () => {
    beforeEach(() => {
      mockVisualViewport = {
        offsetTop: 280,
        height: 420,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;
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
      expect(document.documentElement.style.getPropertyValue('--session-overlay-top-chrome-inset')).toBe('0px');
    });

    it('requestVisualViewportSettle no-ops without visualViewport support', () => {
      delete window.visualViewport;

      requestVisualViewportSettle();

      expect(rafSpy).not.toHaveBeenCalled();
      expect(document.documentElement.style.setProperty).not.toHaveBeenCalled();
    });

    it('starting a second settle replaces the pending settle loop', async () => {
      requestVisualViewportSettle({ maxDurationMs: 120, intervalMs: 20 });
      requestVisualViewportSettle({ maxDurationMs: 120, intervalMs: 20 });

      expect(cancelRafSpy).toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 150));
    });
  });

  describe('Return value', () => {
    beforeEach(() => {
      mockVisualViewport = {
        offsetTop: 75,
        height: 675,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;
    });

    it('returns updateViewportOffset function', () => {
      const wrapper = createTestComponent();

      expect(typeof wrapper.vm.updateViewportOffset).toBe('function');
      expect(typeof wrapper.vm.requestVisualViewportUpdate).toBe('function');
      expect(typeof wrapper.vm.requestVisualViewportSettle).toBe('function');

      wrapper.unmount();
    });

    it('updateViewportOffset can be called manually to trigger update', async () => {
      const wrapper = createTestComponent();

      await nextTick();

      // Clear initial call
      vi.mocked(document.documentElement.style.setProperty).mockClear();

      // Manually trigger update
      wrapper.vm.updateViewportOffset();

      // Wait for RAF
      await new Promise(resolve => setTimeout(resolve, 10));

      expectViewportVariables('75px', '675px');

      wrapper.unmount();
    });

    it('exported requestVisualViewportUpdate can be called manually', async () => {
      createTestComponent();

      await new Promise(resolve => setTimeout(resolve, 10));
      vi.mocked(document.documentElement.style.setProperty).mockClear();

      mockVisualViewport.offsetTop = 125;
      mockVisualViewport.height = 525;
      requestVisualViewportUpdate();

      await new Promise(resolve => setTimeout(resolve, 10));

      expectViewportVariables('125px', '525px');
    });
  });

  describe('Edge cases', () => {
    beforeEach(() => {
      mockVisualViewport = {
        offsetTop: 0,
        height: 700,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;
    });

    it('handles undefined offsetTop (treats as 0)', async () => {
      mockVisualViewport.offsetTop = undefined;

      createTestComponent();

      // Wait for RAF to execute
      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      expectViewportVariables('0px', '700px');
    });

    it('handles null offsetTop (treats as 0)', async () => {
      mockVisualViewport.offsetTop = null;

      createTestComponent();

      // Wait for RAF to execute
      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      expectViewportVariables('0px', '700px');
    });

    it('handles very large offsetTop values', async () => {
      mockVisualViewport.offsetTop = 5000;

      createTestComponent();

      // Wait for RAF to execute
      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      expectViewportVariables('5000px', '700px');
    });

    it('handles undefined height (uses CSS dynamic viewport fallback)', async () => {
      mockVisualViewport.height = undefined;

      createTestComponent();

      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      expectViewportVariables('0px', '100dvh');
    });

    it('handles null height (uses CSS dynamic viewport fallback)', async () => {
      mockVisualViewport.height = null;

      createTestComponent();

      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      expectViewportVariables('0px', '100dvh');
    });

    it('handles very large height values', async () => {
      mockVisualViewport.height = 5000;

      createTestComponent();

      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      expectViewportVariables('0px', '5000px');
    });
  });
});
