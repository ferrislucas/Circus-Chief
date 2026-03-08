import { CassetteStore } from './CassetteStore.js';

/**
 * Build cassette key for summary calls
 * Summary prompts are built from a fixed template + message content, so these are stable
 *
 * @param {object} queryParams - Query parameters
 * @param {string|null} keyHint - Optional stable key hint to use instead of prompt text.
 *   When provided, the cassette key is derived from keyHint rather than the dynamic prompt,
 *   ensuring stable keys across test runs even when prompt content changes.
 * @returns {string} Cassette key
 */
function buildSummaryKey(queryParams, keyHint = null) {
  const keySource = keyHint || queryParams.prompt || '';
  return CassetteStore.buildKey('summary', keySource);
}

/**
 * Create a VCR-wrapped query function for summary service
 *
 * The summary service calls the SDK query() directly rather than going through
 * the agent gateway. This wrapper provides the same record/replay behavior.
 *
 * @param {function} realQueryFn - The real query function to wrap
 * @param {string} cassetteDir - Directory for cassette files
 * @param {string|null} keyHint - Optional stable key hint for cassette key generation.
 *   When provided, overrides the default prompt-based key, ensuring stable cassette
 *   keys across test runs even when prompt content is dynamic.
 * @returns {function} VCR-wrapped query function
 */
export function createVCRQueryFn(realQueryFn, cassetteDir, keyHint = null) {
  // Only enable VCR if VCR_MODE is explicitly set
  const mode = process.env.VCR_MODE || undefined;

  return async function* vcrQuery(queryParams) {
    const key = buildSummaryKey(queryParams, keyHint);
    const cassette = CassetteStore.load(cassetteDir, key);

    // VCR disabled - pass through to real query
    if (!mode) {
      yield* realQueryFn(queryParams);
      return;
    }

    if (mode === 'record' || (mode === 'auto' && !cassette)) {
      // Record mode
      const events = [];
      for await (const event of realQueryFn(queryParams)) {
        events.push(CassetteStore.deepCopyEvent(event));
        yield event;
      }
      CassetteStore.save(cassetteDir, key, {
        prompt: queryParams.prompt?.substring(0, 200),
        model: queryParams.options?.model,
        events,
      });
    } else if (cassette) {
      // Replay mode (cassette exists)
      for (const event of cassette.events) {
        // Small delay to simulate streaming
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield event;
      }
    } else {
      // Replay mode but no cassette
      throw new Error(
        `VCR replay: summary cassette not found for "${key}". Run with VCR_MODE=record to create it.`
      );
    }
  };
}
