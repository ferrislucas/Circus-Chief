import { resolveProviderMetadataFromModel } from './sessionProvider.js';

/** Durable lane delivery requires a provider transport that forwards the
 * stable dispatch key. Keep this check shared by configuration, preflight,
 * and the final dispatch boundary so capability cannot drift by call site. */
export function supportsKanbanProviderIdempotency(model, resolveProvider = resolveProviderMetadataFromModel) {
  const provider = resolveProvider(model);
  return process.env.USE_CODEX_DIRECT_API === '1'
    && provider?.kind === 'openai'
    && Boolean(provider.authToken);
}

export function assertKanbanProviderIdempotency(model) {
  if (!supportsKanbanProviderIdempotency(model)) {
    throw new Error('Lane-entry provider transport does not support idempotent dispatch');
  }
}
