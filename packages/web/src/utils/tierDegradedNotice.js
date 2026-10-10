/**
 * User-visible copy for server-side tier degradations.
 *
 * When a tier is deleted or emptied, persisted bindings are repaired to a
 * concrete model and a `tier:degraded` event is broadcast per affected
 * session. This formatter turns that payload into toast copy.
 */

/**
 * @param {{ tierName?: string|null, degradedFrom?: string|null }|null|undefined} payload
 * @returns {string} The notice to display.
 */
export function formatTierDegradedNotice(payload) {
  const tier = payload?.tierName ? `Model tier "${payload.tierName}"` : 'A model tier';
  return `${tier} changed and this session was moved to a concrete model.`;
}
