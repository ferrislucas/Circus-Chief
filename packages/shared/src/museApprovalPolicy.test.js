import { describe, it, expect } from 'vitest';
import {
  MUSE_APPROVAL_MODE_FOR_SESSION_MODE,
  MUSE_SESSION_MODE_COPY,
  museApprovalModeAutoApproves,
  museApprovalModeForSessionMode,
  museSessionModeCopy,
} from './museApprovalPolicy.js';

describe('museApprovalPolicy', () => {
  it('maps session modes to closed approval postures', () => {
    expect(MUSE_APPROVAL_MODE_FOR_SESSION_MODE).toEqual({
      yolo: 'allowAll',
      plan: 'promptUnmatched',
      standard: 'onRequest',
    });
  });

  it('fails closed to onRequest for unknown session modes', () => {
    expect(museApprovalModeForSessionMode(undefined)).toBe('onRequest');
    expect(museApprovalModeForSessionMode('turbo')).toBe('onRequest');
  });

  it('auto-approves only under allowAll (yolo)', () => {
    expect(museApprovalModeAutoApproves('allowAll')).toBe(true);
    expect(museApprovalModeAutoApproves('onRequest')).toBe(false);
    expect(museApprovalModeAutoApproves('promptUnmatched')).toBe(false);
    expect(museApprovalModeAutoApproves('denyUnmatched')).toBe(false);
    expect(museApprovalModeAutoApproves(undefined)).toBe(false);
  });

  // Exec is headless: gated Muse modes enforce approvals via CLI flags and
  // deny restricted tools without ever prompting, so the copy must not
  // promise interactive approval.
  it('says gated Muse modes deny without prompting (exec is headless)', () => {
    expect(museSessionModeCopy('plan').description).toMatch(/denied without prompting/i);
    expect(museSessionModeCopy('plan').description).not.toMatch(/requests approval/i);
    expect(museSessionModeCopy('standard').description).toMatch(/denied without prompting/i);
    expect(museSessionModeCopy('standard').description).not.toMatch(/requests approval/i);
    expect(museSessionModeCopy('yolo').description).toMatch(/automatically approves/i);
    expect(museSessionModeCopy('turbo')).toBe(MUSE_SESSION_MODE_COPY.standard);
  });
});
