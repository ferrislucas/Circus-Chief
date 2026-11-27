import { describe, expect, it } from 'vitest';
import { selectTierMember } from './tierSelection.js';

function member(providerId, position, catalogTier = null) {
  return { providerId, modelId: providerId, position, catalogTier };
}

function reader(percents) {
  return (providerId) => (
    percents[providerId] === undefined
      ? null
      : { stale: false, status: 'available', allowances: [{ key: 'weekly', remainingPercent: percents[providerId] }] }
  );
}

describe('selectTierMember', () => {
  const members = [member('A', 0), member('B', 1)];

  it('sequential mode keeps the earliest member even when a later one has more remaining', () => {
    const picked = selectTierMember({ members, selectionMode: 'sequential', headroomFor: reader({ A: 10, B: 90 }) });
    expect(picked.member.providerId).toBe('A');
    expect(picked.floorWaived).toBe(false);
  });

  it('skips a member under the floor in both modes', () => {
    const headroomFor = reader({ A: 10, B: 90 });
    expect(selectTierMember({ members, selectionMode: 'sequential', minRemainingPercent: 20, headroomFor }).member.providerId).toBe('B');
    expect(selectTierMember({ members, selectionMode: 'balanced', minRemainingPercent: 20, headroomFor }).member.providerId).toBe('B');
  });

  it('keeps a member whose percent equals the floor', () => {
    const picked = selectTierMember({
      members,
      minRemainingPercent: 20,
      headroomFor: reader({ A: 20, B: 90 }),
    });
    expect(picked.member.providerId).toBe('A');
  });

  it('does not treat an unmeasured member as under the floor', () => {
    const picked = selectTierMember({
      members,
      minRemainingPercent: 20,
      headroomFor: reader({ B: 90 }),
    });
    expect(picked.member.providerId).toBe('A');
  });

  it('balanced mode picks the greatest governing percent', () => {
    const picked = selectTierMember({ members, selectionMode: 'balanced', headroomFor: reader({ A: 10, B: 90 }) });
    expect(picked.member.providerId).toBe('B');
  });

  it('breaks equal percents by position', () => {
    const picked = selectTierMember({ members, selectionMode: 'balanced', headroomFor: reader({ A: 50, B: 50 }) });
    expect(picked.member.providerId).toBe('A');
  });

  it('ranks an unmeasured member after every measured percent', () => {
    const picked = selectTierMember({ members, selectionMode: 'balanced', headroomFor: reader({ A: 4 }) });
    expect(picked.member.providerId).toBe('A');
  });

  it('waives the floor when every candidate is under it', () => {
    const picked = selectTierMember({
      members,
      selectionMode: 'sequential',
      minRemainingPercent: 20,
      headroomFor: reader({ A: 5, B: 5 }),
    });
    expect(picked.member.providerId).toBe('A');
    expect(picked.floorWaived).toBe(true);
  });

  it('returns a single under-floor member instead of null', () => {
    const picked = selectTierMember({
      members: [member('A', 0)],
      minRemainingPercent: 20,
      headroomFor: reader({ A: 5 }),
    });
    expect(picked.member.providerId).toBe('A');
    expect(picked.floorWaived).toBe(true);
  });

  it('does not waive when asked not to', () => {
    const picked = selectTierMember({
      members,
      minRemainingPercent: 20,
      allowWaiver: false,
      headroomFor: reader({ A: 5, B: 5 }),
    });
    expect(picked.member).toBeNull();
    expect(picked.floorWaived).toBe(false);
  });
});
