/** Explicit result of accepting or declining a session execution handoff. */
export function startedSessionExecution(sessionId) {
  return { started: true, sessionId };
}

export function rejectedSessionExecution(sessionId, reason) {
  return { started: false, sessionId, reason };
}

export function didSessionExecutionStart(result, expectedSessionId) {
  return result?.started === true
    && typeof result.sessionId === 'string'
    && result.sessionId.length > 0
    && result.sessionId === expectedSessionId;
}
