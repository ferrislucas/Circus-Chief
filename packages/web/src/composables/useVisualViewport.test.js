import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import {
  requestVisualViewportSettle,
  requestVisualViewportUpdate,
  useVisualViewport,
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

  beforeEach(() => {
    // Save original visualViewport
    originalVisualViewport = window.visualViewport;

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
          requestVisualViewportSettle,
          requestVisualViewportUpdate,
          updateViewportOffset,
        } = useVisualViewport();
        return {
          requestVisualViewportSettle,
          requestVisualViewportUpdate,
          updateViewportOffset,
        };
      },
    };

    return mount(TestComponent, {
      attachTo: document.body,
    });
  }

  function expectViewportVariables(offsetTop, height) {
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--viewport-offset-top',
      offsetTop
    );
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--visual-viewport-height',
      height
    );
  }

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
