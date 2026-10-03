import { describe, it, expect } from 'vitest';
import {
  MUSE_APPROVAL_MODE_FOR_SESSION_MODE,
  MUSE_SESSION_MODE_COPY,
  museApprovalModeAutoApproves,
  museApprovalModeForSessionMode,
  museSessionModeCopy,
} from './museApprovalPolicy.js';

describe('museApprovalPolicy', () => {
  it('maps session modes to closed MSP approval modes', () => {
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

  // Finding #3: gated Muse modes now run a real interactive approval
  // round-trip (promptStore + WS prompt events), so the copy reverts to
  // honest per-mode wording instead of the interim "runs no tools" denial.
  it('says gated Muse modes request approval for each tool now that prompting is real', () => {
    expect(museSessionModeCopy('plan').description).toMatch(/approval for each tool/i);
    expect(museSessionModeCopy('plan').description).not.toMatch(/no tools/i);
    expect(museSessionModeCopy('standard').description).toMatch(/approval for each tool/i);
    expect(museSessionModeCopy('standard').description).not.toMatch(/no tools/i);
    expect(museSessionModeCopy('yolo').description).toMatch(/automatically approves/i);
    expect(museSessionModeCopy('turbo')).toBe(MUSE_SESSION_MODE_COPY.standard);
  });
});
