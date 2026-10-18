import { describe, it, expect } from 'vitest';
import { buildUpdateData, FIELD_DEFINITIONS } from './sessions-patch-validation.js';

describe('sessions-patch-validation', () => {
  it('exports FIELD_DEFINITIONS for the sessions-patch re-export', () => {
    expect(Array.isArray(FIELD_DEFINITIONS)).toBe(true);
    expect(FIELD_DEFINITIONS.length).toBeGreaterThan(0);
    for (const def of FIELD_DEFINITIONS) {
      expect(typeof def.field).toBe('string');
    }
  });

  it('auto-sets manuallyNamed when name is updated', () => {
    const { updateData, error } = buildUpdateData({ name: 'New name' });
    expect(error).toBeUndefined();
    expect(updateData).toMatchObject({ name: 'New name', manuallyNamed: true });
  });

  it('ignores unknown body fields', () => {
    const { updateData, error } = buildUpdateData({ name: 'x', noSuchField: 1 });
    expect(error).toBeUndefined();
    expect(updateData).toEqual({ name: 'x', manuallyNamed: true });
  });
});
