import { isCodexAppServerAllowanceSourceEnabled } from '../config/providerAllowances.js';
import { CodexAppServerMeter } from './codexAppServerMeter.js';

let activeMeter = null;

export async function startCodexAppServerMeter({ modelProviders, getObserver } = {}) {
  stopCodexAppServerMeter();
  if (!isCodexAppServerAllowanceSourceEnabled()) return null;
  activeMeter = new CodexAppServerMeter({ modelProviders, getObserver });
  await activeMeter.start();
  return activeMeter;
}

export function stopCodexAppServerMeter() {
  if (!activeMeter) return;
  const meter = activeMeter;
  activeMeter = null;
  meter.stop();
}

export function isCodexAppServerMeterHealthy() {
  return activeMeter?.healthy === true;
}

/** @private Test-only singleton control. */
export function _setActiveCodexAppServerMeterForTests(meter) {
  activeMeter = meter;
}
