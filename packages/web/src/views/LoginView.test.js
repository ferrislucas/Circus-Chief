import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import LoginView from './LoginView.vue';

// Mock the auth store
const mockLogin = vi.fn();
vi.mock('../stores/auth.js', () => ({
  useAuthStore: vi.fn(() => ({
    login: mockLogin,
    markRequired: vi.fn(),
    isAuthenticated: false,
    required: false,
    credentials: null,
  })),
}));

// Mock the reconnectWithAuth function — must use vi.hoisted for proper ordering
const { mockReconnectWithAuth } = vi.hoisted(() => ({
  mockReconnectWithAuth: vi.fn(),
}));
vi.mock('../composables/useWebSocket.js', () => ({
  reconnectWithAuth: mockReconnectWithAuth,
}));

describe('LoginView', () => {
  let pinia;
  let router;

  beforeEach(() => {
    vi.clearAllMocks();
    pinia = createPinia();
    setActivePinia(pinia);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'Home' },
        { path: '/login', name: 'Login', component: LoginView },
      ],
    });
  });

  function mountLogin() {
    return mount(LoginView, {
      global: {
        plugins: [pinia, router],
      },
    });
  }

  describe('rendering', () => {
    it('renders username and password inputs', () => {
      const wrapper = mountLogin();

      expect(wrapper.find('#username').exists()).toBe(true);
      expect(wrapper.find('#password').exists()).toBe(true);
    });

    it('renders a submit button', () => {
      const wrapper = mountLogin();

      const button = wrapper.find('button[type="submit"]');
      expect(button.exists()).toBe(true);
      expect(button.text()).toContain('Sign in');
    });

    it('has required attribute on inputs', () => {
      const wrapper = mountLogin();

      expect(wrapper.find('#username').attributes('required')).toBeDefined();
      expect(wrapper.find('#password').attributes('required')).toBeDefined();
    });

    it('has correct autocomplete attributes', () => {
      const wrapper = mountLogin();

      expect(wrapper.find('#username').attributes('autocomplete')).toBe('username');
      expect(wrapper.find('#password').attributes('autocomplete')).toBe('current-password');
    });
  });

  describe('form submission', () => {
    it('calls auth store login with username and password', async () => {
      mockLogin.mockResolvedValue(undefined);
      const wrapper = mountLogin();

      await wrapper.find('#username').setValue('admin');
      await wrapper.find('#password').setValue('secret123');
      await wrapper.find('form').trigger('submit.prevent');
      await flushPromises();

      expect(mockLogin).toHaveBeenCalledWith('admin', 'secret123');
    });

    it('navigates to home on successful login', async () => {
      mockLogin.mockResolvedValue(undefined);
      const pushSpy = vi.spyOn(router, 'push');
      const wrapper = mountLogin();

      await wrapper.find('#username').setValue('admin');
      await wrapper.find('#password').setValue('secret123');
      await wrapper.find('form').trigger('submit.prevent');
      await flushPromises();

      expect(pushSpy).toHaveBeenCalledWith('/');
    });

    it('displays error message on login failure', async () => {
      mockLogin.mockRejectedValue(new Error('Invalid username or password'));
      const wrapper = mountLogin();

      await wrapper.find('#username').setValue('admin');
      await wrapper.find('#password').setValue('wrong');
      await wrapper.find('form').trigger('submit.prevent');
      await flushPromises();

      expect(wrapper.find('.error-message').text()).toBe('Invalid username or password');
    });

    it('shows loading state during login', async () => {
      let resolveLogin;
      mockLogin.mockReturnValue(new Promise((resolve) => { resolveLogin = resolve; }));
      const wrapper = mountLogin();

      await wrapper.find('#username').setValue('admin');
      await wrapper.find('#password').setValue('secret');
      await wrapper.find('form').trigger('submit.prevent');
      await flushPromises();

      // Button should show loading text
      expect(wrapper.find('button[type="submit"]').text()).toContain('Signing in...');
      expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();

      // Inputs should be disabled
      expect(wrapper.find('#username').attributes('disabled')).toBeDefined();
      expect(wrapper.find('#password').attributes('disabled')).toBeDefined();

      // Resolve the login
      resolveLogin();
      await flushPromises();

      // Loading state should be cleared
      expect(wrapper.find('button[type="submit"]').text()).toContain('Sign in');
    });

    it('clears error on new submission', async () => {
      mockLogin.mockRejectedValueOnce(new Error('First error'));
      mockLogin.mockResolvedValueOnce(undefined);
      const wrapper = mountLogin();

      // First submission fails
      await wrapper.find('#username').setValue('admin');
      await wrapper.find('#password').setValue('wrong');
      await wrapper.find('form').trigger('submit.prevent');
      await flushPromises();
      expect(wrapper.find('.error-message').exists()).toBe(true);

      // Second submission succeeds
      await wrapper.find('form').trigger('submit.prevent');
      await flushPromises();
      expect(wrapper.find('.error-message').exists()).toBe(false);
    });
  });
});
