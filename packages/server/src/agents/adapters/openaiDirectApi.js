import { extractOpenAIAllowance } from './openaiAllowanceExtractor.js';
import { isOpenAIAllowanceSourceEnabled } from '../../config/providerAllowances.js';

export async function resolveOpenAIStream(request) {
  if (request && typeof request.withResponse === 'function') {
    const { data, response } = await request.withResponse();
    return { stream: data, headers: response?.headers ?? null };
  }
  return { stream: await request, headers: null };
}

export async function createOpenAIStream({ client, request, requestOptions, providerId, allowanceObserver, clock }) {
  const { stream, headers } = await resolveOpenAIStream(client.chat.completions.create(request, requestOptions));
  observeOpenAIAllowance({ headers, providerId, allowanceObserver, clock });
  return stream;
}

export function observeOpenAIAllowance({ headers, providerId, allowanceObserver, clock = Date }) {
  if (!allowanceObserver || !providerId) return;
  // Header observation is an acquisition source like any other: it stays
  // inert unless both the master gate and its own sub-flag opt in.
  if (!isOpenAIAllowanceSourceEnabled()) return;
  const candidate = extractOpenAIAllowance(headers, { observedAt: clock.now() });
  if (!candidate) return;
  try {
    allowanceObserver({ ...candidate, providerId });
  } catch {
    // Allowance telemetry is non-critical; never expose response metadata or
    // make an otherwise valid provider completion fail because it is absent.
  }
}
