import { CassetteStore } from './CassetteStore.js';

/**
 * Build cassette key for summary calls
 * Summary prompts are built from a fixed template + message content, so these are stable
 *
 * @param {object} queryParams - Query parameters
 * @returns {string} Cassette key
 */
function buildSummaryKey(queryParams) {
  const promptText = queryParams.prompt || '';
  return CassetteStore.buildKey('summary', promptText);
}

/**
 * Create a VCR-wrapped query function for summary service
 *
 * The summary service calls the SDK query() directly rather than going through
 * the agent gateway. This wrapper provides the same record/replay behavior.
 *
 * @param {function} realQueryFn - The real query function to wrap
 * @param {string} cassetteDir - Directory for cassette files
 * @returns {function} VCR-wrapped query function
 */
export function createVCRQueryFn(realQueryFn, cassetteDir) {
  const mode = process.env.VCR_MODE || 'auto';

  return async function* vcrQuery(queryParams) {
    const key = buildSummaryKey(queryParams);
    const cassette = CassetteStore.load(cassetteDir, key);

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
