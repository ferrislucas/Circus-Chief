import { describe, expect, it } from 'vitest';
import { SESSION_CALLER_IDENTITY_HINT_HEADER } from '@circuschief/shared';
import { createSessionCallerCapability } from './sessionCallerCapability.js';
import {
  REDACTED_SESSION_CALLER_IDENTITY_HINT,
  redactSessionCallerIdentityHint,
  redactSessionCallerIdentityHintValue,
} from './sessionCallerIdentityRedaction.js';

describe('session caller identity hint redaction', () => {
  it('redacts both a known bare hint and its header form', () => {
    const sessionId = 'session-1';
    const hint = createSessionCallerCapability(sessionId);
    const content = `echoed ${hint}\n${SESSION_CALLER_IDENTITY_HINT_HEADER}: ${hint}`;

    const redacted = redactSessionCallerIdentityHint(content, sessionId);

    expect(redacted).toContain(REDACTED_SESSION_CALLER_IDENTITY_HINT);
    expect(redacted).not.toContain(hint);
  });

  it('redacts nested VCR-style values without mutating the source', () => {
    const source = { events: [{ text: `${SESSION_CALLER_IDENTITY_HINT_HEADER}: hint` }] };

    const redacted = redactSessionCallerIdentityHintValue(source);

    expect(redacted.events[0].text).toContain(REDACTED_SESSION_CALLER_IDENTITY_HINT);
    expect(source.events[0].text).toContain('hint');
  });
});
