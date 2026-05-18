import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import {
  computeSessionOverlayKeyboardBottomInset,
  computeSessionOverlayTopChromeInset,
  requestVisualViewportSettle,
  requestVisualViewportUpdate,
  setSessionOverlayPromptFocus,
  useVisualViewport,
  writeVisualViewportVariables,
  checkOverlayViewportDrift,
  clearOverlayViewportDrift,
  onVisualViewportChange,
  isActiveTextEditing,
  isTextEditingElement,
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

  function expectKeyboardInset(value) {
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--session-overlay-keyboard-bottom-inset',
      value
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

  describe('text editing detection', () => {
    it('returns true for textarea elements', () => {
      expect(isTextEditingElement(document.createElement('textarea'))).toBe(true);
    });

    it.each([
      [null],
      [''],
      ['text'],
      ['search'],
      ['email'],
      ['url'],
      ['tel'],
      ['password'],
      ['number'],
    ])('returns true for text-like input type %s', (type) => {
      const input = document.createElement('input');
      if (type !== null) {
        input.setAttribute('type', type);
      }

      expect(isTextEditingElement(input)).toBe(true);
    });

    it('returns true for contenteditable elements and descendants', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      const child = document.createElement('span');
      editor.appendChild(child);

      expect(isTextEditingElement(editor)).toBe(true);
      expect(isTextEditingElement(child)).toBe(true);
    });

    it.each([
      'checkbox',
      'radio',
      'range',
      'button',
      'submit',
      'reset',
      'file',
      'color',
      'date',
      'datetime-local',
      'month',
      'time',
      'week',
      'hidden',
      'image',
    ])('returns false for non-text input type %s', (type) => {
      const input = document.createElement('input');
      input.setAttribute('type', type);

      expect(isTextEditingElement(input)).toBe(false);
    });

    it('isActiveTextEditing follows document.activeElement', () => {
      const textarea = document.createElement('textarea');
      const button = document.createElement('button');
      document.body.append(textarea, button);

      textarea.focus();
      expect(isActiveTextEditing()).toBe(true);

      button.focus();
      expect(isActiveTextEditing()).toBe(false);

      textarea.remove();
      button.remove();
    });
  });

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
      expect(
        computeSessionOverlayKeyboardBottomInset({
          ...focusedIPad,
          isOverlayPromptFocused: false,
        })
      ).toBe(0);
    });

    it('returns 0 for phone-class keyboard-shaped viewports', () => {
      for (const [layoutWidth, layoutHeight, visualViewportHeight] of [
        [390, 844, 500],
        [375, 812, 420],
        [360, 640, 360],
        [320, 568, 320],
      ]) {
        expect(
          computeSessionOverlayKeyboardBottomInset({
            isOverlayPromptFocused: true,
            layoutWidth,
            layoutHeight,
            visualViewportHeight,
            visualViewportOffsetTop: 0,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
            platform: 'iPhone',
            maxTouchPoints: 5,
          })
        ).toBe(0);
      }
    });

    it('returns 0 for non-touch tablet-sized layouts', () => {
      expect(
        computeSessionOverlayKeyboardBottomInset({
          ...focusedIPad,
          platform: 'Linux x86_64',
          maxTouchPoints: 0,
        })
      ).toBe(0);
    });

    it('returns 0 when focused without a keyboard-shaped viewport', () => {
      expect(
        computeSessionOverlayKeyboardBottomInset({
          ...focusedIPad,
          visualViewportHeight: 950,
        })
      ).toBe(0);
    });

    it('adds accessory allowance to the keyboard overlap on iPad-like touch devices', () => {
      expect(
        computeSessionOverlayKeyboardBottomInset(focusedIPad)
      ).toBe(344);
    });

    it('includes visualViewport offsetTop in the overlap calculation', () => {
      expect(
        computeSessionOverlayKeyboardBottomInset({
          ...focusedIPad,
          visualViewportHeight: 620,
          visualViewportOffsetTop: 80,
        })
      ).toBe(364);
    });

    it('clamps stale or extreme values to the absolute maximum', () => {
      expect(
        computeSessionOverlayKeyboardBottomInset({
          ...focusedIPad,
          visualViewportHeight: 700,
          visualViewportOffsetTop: 0,
          absoluteMax: 300,
        })
      ).toBe(300);
    });

    it('clamps short landscape-like values to preserve usable overlay height', () => {
      expect(
        computeSessionOverlayKeyboardBottomInset({
          ...focusedIPad,
          layoutWidth: 800,
          layoutHeight: 430,
          visualViewportHeight: 200,
          visualViewportOffsetTop: 0,
          absoluteMax: 420,
        })
      ).toBe(40);
    });

    it('clamps portrait-like values to preserve usable overlay height', () => {
      expect(
        computeSessionOverlayKeyboardBottomInset({
          ...focusedIPad,
          layoutHeight: 700,
          visualViewportHeight: 300,
          visualViewportOffsetTop: 0,
          absoluteMax: 420,
        })
      ).toBe(140);
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
      expectKeyboardInset('0px');
    });

    it('writes and clears the session overlay keyboard bottom inset', () => {
      setLayoutViewport(744, 1000);
      const originalPlatform = navigator.platform;
      const originalTouch = navigator.maxTouchPoints;
      Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
      mockVisualViewport.offsetTop = 20;
      mockVisualViewport.height = 600;

      setSessionOverlayPromptFocus(true);
      writeVisualViewportVariables();

      expectKeyboardInset('420px');
      expect(document.documentElement.style.getPropertyValue('--session-overlay-top-chrome-inset')).toBe('0px');

      setSessionOverlayPromptFocus(false);

      expectKeyboardInset('0px');
      Object.defineProperty(navigator, 'platform', { configurable: true, value: originalPlatform });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: originalTouch });
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

  // -----------------------------------------------------------------------
  // checkOverlayViewportDrift
  // -----------------------------------------------------------------------
  describe('checkOverlayViewportDrift', () => {
    let element;
    let scrollToSpy;

    beforeEach(() => {
      element = document.createElement('div');
      document.body.appendChild(element);

      scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        writable: true,
        value: 0,
      });
    });

    afterEach(() => {
      element.remove();
      scrollToSpy.mockRestore();
      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        writable: true,
        value: 0,
      });
    });

    it('does nothing when element is null', () => {
      checkOverlayViewportDrift(null);
      // No error thrown
    });

    it('resets window.scrollTo(0, 0) when window.scrollY is non-zero', () => {
      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        writable: true,
        value: 50,
      });
      mockVisualViewport = {
        offsetTop: 0,
        height: 700,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      checkOverlayViewportDrift(element);

      expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
    });

    it('does not reset window scroll while an editable control is focused', () => {
      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        writable: true,
        value: 50,
      });
      mockVisualViewport = {
        offsetTop: 32,
        height: 968,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();

      checkOverlayViewportDrift(element);

      expect(scrollToSpy).not.toHaveBeenCalled();

      textarea.remove();
    });

    it('does not set or clear drift styles while an editable control is focused', () => {
      mockVisualViewport = {
        offsetTop: 32,
        height: 968,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;
      element.style.top = '12px';
      element.style.bottom = 'auto';
      element.style.height = '700px';
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);
      input.focus();

      checkOverlayViewportDrift(element);

      expect(element.style.top).toBe('12px');
      expect(element.style.bottom).toBe('auto');
      expect(element.style.height).toBe('700px');

      input.remove();
    });

    it('does not call scrollTo when window.scrollY is 0', () => {
      mockVisualViewport = {
        offsetTop: 0,
        height: 700,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      checkOverlayViewportDrift(element);

      expect(scrollToSpy).not.toHaveBeenCalled();
    });

    it('applies inline styles when iPad drift is detected', () => {
      // iPad: tablet-sized layout, non-keyboard viewport, offsetTop > threshold
      setLayoutViewport(744, 1000);
      mockVisualViewport = {
        offsetTop: 32,
        height: 968,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      // Use iPad user agent
      const originalUA = navigator.userAgent;
      const originalPlatform = navigator.platform;
      const originalTouch = navigator.maxTouchPoints;
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      });
      Object.defineProperty(navigator, 'platform', {
        configurable: true,
        value: 'MacIntel',
      });
      Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        value: 5,
      });

      checkOverlayViewportDrift(element);

      expect(element.style.top).toBe('32px');
      expect(element.style.bottom).toBe('auto');
      expect(element.style.height).toBe('968px');

      // Restore
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUA });
      Object.defineProperty(navigator, 'platform', { configurable: true, value: originalPlatform });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: originalTouch });
    });

    it('clears inline styles when no drift on iPad', () => {
      setLayoutViewport(744, 1000);
      mockVisualViewport = {
        offsetTop: 0,
        height: 1000,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      // Pre-set inline styles as if a previous correction was applied
      element.style.top = '32px';
      element.style.bottom = 'auto';
      element.style.height = '968px';

      const originalPlatform = navigator.platform;
      const originalTouch = navigator.maxTouchPoints;
      Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });

      checkOverlayViewportDrift(element);

      expect(element.style.top).toBe('');
      expect(element.style.bottom).toBe('');
      expect(element.style.height).toBe('');

      Object.defineProperty(navigator, 'platform', { configurable: true, value: originalPlatform });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: originalTouch });
    });

    it('skips correction on iPhone even with non-zero offsetTop', () => {
      setLayoutViewport(375, 812);
      mockVisualViewport = {
        offsetTop: 32,
        height: 780,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      const originalUA = navigator.userAgent;
      const originalPlatform = navigator.platform;
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      });
      Object.defineProperty(navigator, 'platform', {
        configurable: true,
        value: 'iPhone',
      });

      checkOverlayViewportDrift(element);

      // Should NOT apply drift correction on phone
      expect(element.style.top).toBe('');
      expect(element.style.bottom).toBe('');
      expect(element.style.height).toBe('');

      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUA });
      Object.defineProperty(navigator, 'platform', { configurable: true, value: originalPlatform });
    });

    it('skips correction when keyboard is open on iPad', () => {
      // iPad layout but keyboard-shaped viewport (height much smaller than layout)
      setLayoutViewport(744, 1000);
      mockVisualViewport = {
        offsetTop: 32,
        height: 500, // < 85% of 1000, keyboard detected
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      const originalPlatform = navigator.platform;
      const originalTouch = navigator.maxTouchPoints;
      Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });

      checkOverlayViewportDrift(element);

      // Should NOT apply drift correction when keyboard is detected
      expect(element.style.top).toBe('');
      expect(element.style.bottom).toBe('');
      expect(element.style.height).toBe('');

      Object.defineProperty(navigator, 'platform', { configurable: true, value: originalPlatform });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: originalTouch });
    });

    it('skips correction on Android Mobile even with non-zero offsetTop', () => {
      setLayoutViewport(412, 915);
      mockVisualViewport = {
        offsetTop: 20,
        height: 895,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      const originalUA = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36',
      });

      checkOverlayViewportDrift(element);

      expect(element.style.top).toBe('');
      expect(element.style.bottom).toBe('');
      expect(element.style.height).toBe('');

      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUA });
    });

    it('applies correction on Android tablet with drift', () => {
      setLayoutViewport(800, 1000);
      mockVisualViewport = {
        offsetTop: 20,
        height: 980,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      const originalUA = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Safari/537.36',
      });

      checkOverlayViewportDrift(element);

      expect(element.style.top).toBe('20px');
      expect(element.style.bottom).toBe('auto');
      expect(element.style.height).toBe('980px');

      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUA });
    });

    it('skips correction when offsetTop is below threshold', () => {
      setLayoutViewport(744, 1000);
      mockVisualViewport = {
        offsetTop: 1, // below DRIFT_THRESHOLD_PX of 2
        height: 999,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      const originalPlatform = navigator.platform;
      const originalTouch = navigator.maxTouchPoints;
      Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });

      checkOverlayViewportDrift(element);

      expect(element.style.top).toBe('');

      Object.defineProperty(navigator, 'platform', { configurable: true, value: originalPlatform });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: originalTouch });
    });

    it('calls writeVisualViewportVariables regardless of drift state', () => {
      mockVisualViewport = {
        offsetTop: 0,
        height: 700,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      vi.mocked(document.documentElement.style.setProperty).mockClear();

      checkOverlayViewportDrift(element);

      // writeVisualViewportVariables sets 3 CSS properties
      expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
        '--viewport-offset-top',
        expect.any(String),
      );
    });

    it('still calls writeVisualViewportVariables when visualViewport is absent', () => {
      delete window.visualViewport;

      vi.mocked(document.documentElement.style.setProperty).mockClear();

      checkOverlayViewportDrift(element);

      // writeVisualViewportVariables returns null when API is absent,
      // but calling it should not throw.
      expect(document.documentElement.style.setProperty).not.toHaveBeenCalled();
    });

    it('skips correction on small-screen desktop without phone/tablet signal', () => {
      // Small screen that is not a phone or tablet (no touch, small layout)
      setLayoutViewport(400, 600);
      mockVisualViewport = {
        offsetTop: 20,
        height: 580,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      const originalUA = navigator.userAgent;
      const originalPlatform = navigator.platform;
      const originalTouch = navigator.maxTouchPoints;
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      });
      Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });

      checkOverlayViewportDrift(element);

      // Not tablet-sized (min dimension 400 < 700), not a tablet UA → no correction
      expect(element.style.top).toBe('');

      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUA });
      Object.defineProperty(navigator, 'platform', { configurable: true, value: originalPlatform });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: originalTouch });
    });
  });

  // -----------------------------------------------------------------------
  // clearOverlayViewportDrift
  // -----------------------------------------------------------------------
  describe('clearOverlayViewportDrift', () => {
    it('does nothing when element is null', () => {
      clearOverlayViewportDrift(null);
      // No error thrown
    });

    it('clears top, bottom, and height inline styles', () => {
      const el = document.createElement('div');
      el.style.top = '32px';
      el.style.bottom = 'auto';
      el.style.height = '968px';

      clearOverlayViewportDrift(el);

      expect(el.style.top).toBe('');
      expect(el.style.bottom).toBe('');
      expect(el.style.height).toBe('');
    });

    it('is safe to call on an element with no inline styles', () => {
      const el = document.createElement('div');

      clearOverlayViewportDrift(el);

      expect(el.style.top).toBe('');
      expect(el.style.bottom).toBe('');
      expect(el.style.height).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // onVisualViewportChange
  // -----------------------------------------------------------------------
  describe('onVisualViewportChange', () => {
    it('registers scroll and resize listeners and returns cleanup', () => {
      mockVisualViewport = {
        offsetTop: 0,
        height: 700,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      window.visualViewport = mockVisualViewport;

      const callback = vi.fn();
      const cleanup = onVisualViewportChange(callback);

      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith('scroll', callback);
      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith('resize', callback);

      cleanup();

      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith('scroll', callback);
      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith('resize', callback);
    });

    it('returns a no-op cleanup when visualViewport is absent', () => {
      delete window.visualViewport;

      const callback = vi.fn();
      const cleanup = onVisualViewportChange(callback);

      expect(typeof cleanup).toBe('function');
      // Should not throw
      cleanup();
    });
  });
});
