import { withFreshness } from './ProviderAllowanceService.js';
import { getProviderAllowanceService } from './providerAllowanceServiceInstance.js';
import { governingPercent } from './tierHeadroom.js';

let headroomReader = null;

export function setTierHeadroomReader(reader) {
  headroomReader = reader;
}

export function resetTierHeadroomReader() {
  headroomReader = null;
}

export function headroomFor(providerId) {
  if (headroomReader) return headroomReader(providerId);
  const raw = getProviderAllowanceService().getSnapshot(providerId);
  return raw ? withFreshness(raw, Date.now()) : null;
}

export function readTierPolicy(tier) {
  return {
    selectionMode: tier?.selectionMode === 'balanced' ? 'balanced' : 'sequential',
    minRemainingPercent: Number.isInteger(tier?.minRemainingPercent) ? tier.minRemainingPercent : null,
  };
}

export function isMemberUnderFloor(member, minRemainingPercent, readHeadroom = headroomFor) {
  if (!Number.isInteger(minRemainingPercent)) return false;
  const percent = governingPercent(readHeadroom(member.providerId), member.catalogTier ?? null);
  return percent !== null && percent < minRemainingPercent;
}

function memberKey(member) {
  return `${member.providerId}::${member.modelId}`;
}

function bindingPercent(member, readHeadroom) {
  return governingPercent(readHeadroom(member.providerId), member.catalogTier ?? null);
}

function comparePercent(leftPercent, rightPercent) {
  if (leftPercent === null && rightPercent === null) return 0;
  if (leftPercent === null) return 1;
  if (rightPercent === null) return -1;
  return rightPercent - leftPercent;
}

function compareMembers(left, right, selectionMode, readHeadroom) {
  if (selectionMode === 'balanced') {
    const byPercent = comparePercent(bindingPercent(left, readHeadroom), bindingPercent(right, readHeadroom));
    if (byPercent !== 0) return byPercent;
  }
  return left.position - right.position;
}

function eligibleMembers(members, excludeKeys, isEligible, isUnavailable) {
  return members.filter((member) => (
    !excludeKeys.has(memberKey(member)) && !isUnavailable(member) && isEligible(member)
  ));
}

/**
 * Pick one tier member. `floorWaived` is true only when every base candidate
 * was under the floor and the floor was ignored for this decision.
 */
export function selectTierMember({
  members,
  selectionMode = 'sequential',
  minRemainingPercent = null,
  excludeKeys = new Set(),
  isEligible = () => true,
  isUnavailable = () => false,
  headroomFor: readHeadroom = headroomFor,
  allowWaiver = true,
}) {
  const base = eligibleMembers(members, excludeKeys, isEligible, isUnavailable);
  const floorOn = Number.isInteger(minRemainingPercent);
  const above = floorOn
    ? base.filter((member) => !isMemberUnderFloor(member, minRemainingPercent, readHeadroom))
    : base;
  const waived = floorOn && above.length === 0 && base.length > 0 && allowWaiver;
  const pool = waived ? base : above;
  const ranked = [...pool].sort((left, right) => compareMembers(left, right, selectionMode, readHeadroom));
  return { member: ranked[0] ?? null, floorWaived: Boolean(waived && ranked[0]) };
}

/**
 * Continuation successor. Balanced tiers and a pin that left the tier are
 * re-ranked. Sequential pins walk forward. `allowWaiver` drops the floor
 * instead of letting the selector waive inside an already-filtered pool.
 */
export function selectContinuationSuccessor({
  members,
  origin,
  policy,
  allowWaiver = false,
  isEligible,
  isUnavailable,
  keyOf,
  findNext,
}) {
  const originInTier = Boolean(origin) && members.some((member) => keyOf(member) === keyOf(origin));
  const excludeKeys = new Set(originInTier ? [keyOf(origin)] : []);
  if (policy.selectionMode === 'balanced' || !originInTier) {
    return selectTierMember({
      members,
      selectionMode: policy.selectionMode,
      minRemainingPercent: allowWaiver ? null : policy.minRemainingPercent,
      excludeKeys,
      isEligible,
      isUnavailable,
      headroomFor,
      allowWaiver: false,
    }).member;
  }
  return findNext(members, origin, excludeKeys, (member) => (
    isEligible(member) && (allowWaiver || !isMemberUnderFloor(member, policy.minRemainingPercent, headroomFor))
  ));
}
