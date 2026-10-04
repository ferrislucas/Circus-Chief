import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import MuseDiagnosticsView from './MuseDiagnosticsView.vue';

vi.mock('../composables/useApi.js', () => ({
  api: { getMuseEnvDiagnostics: vi.fn() },
}));

import { api } from '../composables/useApi.js';

const SIGNALS = [
  { signal: 'muse-bin', ok: true, origin: '/Users/u/.local/bin/muse', remediation: null },
  { signal: 'ssh-agent', ok: false, origin: 'socket path', remediation: 'SSH agent not reachable. Run `ssh-add -l` in your terminal.' },
  { signal: 'gh-auth', ok: true, origin: 'token env', remediation: null },
];

describe('MuseDiagnosticsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getMuseEnvDiagnostics.mockResolvedValue({
      probe: { ok: true },
      signals: SIGNALS,
      env: { GH_TOKEN: { state: 'SET', origin: 'login-shell' } },
    });
  });

  it('renders remediation text for a failed ssh-agent signal', async () => {
    const wrapper = mount(MuseDiagnosticsView);
    await flushPromises();

    expect(api.getMuseEnvDiagnostics).toHaveBeenCalled();
    expect(wrapper.text()).toContain('ssh-agent');
    expect(wrapper.text()).toContain('ssh-add -l');
  });

  it('never renders secret values in the DOM', async () => {
    const sentinel = 'TEST_SENTINEL_DIAG_SECRET_X7';
    // A secret echoed anywhere in the payload must not reach the DOM: the
    // view renders signal status plus remediation text only.
    api.getMuseEnvDiagnostics.mockResolvedValueOnce({
      probe: { ok: true },
      signals: [
        { signal: 'gh-auth', ok: true, origin: 'token env', remediation: null },
      ],
      env: { GH_TOKEN: sentinel },
    });

    const wrapper = mount(MuseDiagnosticsView);
    await flushPromises();

    expect(wrapper.html()).not.toContain(sentinel);
  });

  it('re-probes when the re-check button is clicked', async () => {
    const wrapper = mount(MuseDiagnosticsView);
    await flushPromises();
    expect(api.getMuseEnvDiagnostics).toHaveBeenCalledWith(false);

    await wrapper.find('[data-testid="muse-diag-recheck"]').trigger('click');
    await flushPromises();
    expect(api.getMuseEnvDiagnostics).toHaveBeenCalledWith(true);
  });

  // Finding #8: the API already returns a per-key env summary
  // ({ state: 'SET'|'UNSET', origin, entries? }); the view must render it
  // so "does HOME come from the login shell or a fallback?" is one glance.
  it('renders the env summary section with per-key SET/UNSET and origin labels (finding #8)', async () => {
    api.getMuseEnvDiagnostics.mockResolvedValueOnce({
      probe: { ok: true },
      signals: SIGNALS,
      env: {
        PATH: { state: 'SET', origin: 'login-shell', entries: 12 },
        HOME: { state: 'SET', origin: 'explicit' },
        SSH_AUTH_SOCK: { state: 'UNSET', origin: 'unset' },
      },
    });

    const wrapper = mount(MuseDiagnosticsView);
    await flushPromises();

    const envSection = wrapper.find('[data-testid="muse-diag-env-summary"]');
    expect(envSection.exists()).toBe(true);
    const text = envSection.text();
    expect(text).toContain('PATH');
    expect(text).toContain('login-shell');
    expect(text).toContain('12 entries');
    expect(text).toContain('HOME');
    expect(text).toContain('explicit');
    expect(text).toContain('SSH_AUTH_SOCK');
    expect(text).toContain('UNSET');
  });

  it('renders no env summary section when the API returns none', async () => {
    api.getMuseEnvDiagnostics.mockResolvedValueOnce({ probe: { ok: true }, signals: SIGNALS });
    const wrapper = mount(MuseDiagnosticsView);
    await flushPromises();
    expect(wrapper.find('[data-testid="muse-diag-env-summary"]').exists()).toBe(false);
  });
});
