/* eslint-env vitest */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import LoginView from './LoginView.vue';
import { api } from '../api/index.js';
import { authRequired, clearCredentials, hasCredentials } from '../api/auth.js';

vi.mock('../api/index.js', () => ({
  api: { getProjects: vi.fn() },
}));

describe('LoginView.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCredentials();
    authRequired.value = false;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCredentials();
    authRequired.value = false;
  });

  function mountView() {
    return mount(LoginView, { attachTo: document.body });
  }

  it('renders username and password fields with a disabled-until-filled button', async () => {
    const wrapper = mountView();
    expect(wrapper.find('input[type="text"]').exists()).toBe(true);
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('successful login stores credentials and clears the challenge', async () => {
    api.getProjects.mockResolvedValue([]);
    const wrapper = mountView();

    await wrapper.find('input[type="text"]').setValue('alice');
    await wrapper.find('input[type="password"]').setValue('s3cret');
    await wrapper.find('form').trigger('submit.prevent');
    await nextTick();
    await nextTick();

    expect(api.getProjects).toHaveBeenCalledTimes(1);
    expect(hasCredentials()).toBe(true);
    expect(authRequired.value).toBe(false);
    expect(wrapper.text()).not.toContain('Invalid username');
    wrapper.unmount();
  });

  it('failed login shows an error and stores nothing', async () => {
    const err = new Error('Authentication required');
    err.code = 'AUTH_REQUIRED';
    api.getProjects.mockRejectedValue(err);
    const wrapper = mountView();

    await wrapper.find('input[type="text"]').setValue('alice');
    await wrapper.find('input[type="password"]').setValue('wrong');
    await wrapper.find('form').trigger('submit.prevent');
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain('Invalid username or password.');
    expect(hasCredentials()).toBe(false);
    expect(authRequired.value).toBe(true);
    wrapper.unmount();
  });
});
