import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Process-local by design: callers from an earlier server process cannot be
// active, and their capabilities should stop working after restart.
const secret = randomBytes(32);

/**
 * Return the low-privilege identity hint placed in one session's agent
 * instructions. It only identifies a card-move caller as its own worker; it
 * is not an authorization secret and must not be reused for other access.
 */
export function createSessionCallerCapability(sessionId) {
  return createHmac('sha256', secret).update(sessionId).digest('base64url');
}

/** Verify that a request's identity hint matches its claimed session. */
export function verifySessionCallerCapability(sessionId, capability) {
  if (!sessionId || !capability) return false;
  const expected = createSessionCallerCapability(sessionId);
  const actualBuffer = Buffer.from(capability);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
