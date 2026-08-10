import { resolveProviderMetadataFromModel } from './sessionProvider.js';

/** Durable lane delivery requires an explicit provider contract. Provider
 * kind and forwarding a header are not proof that an OpenAI-compatible
 * endpoint deduplicates a lost-ack retry. */
export function supportsKanbanProviderIdempotency(model, resolveProvider = resolveProviderMetadataFromModel) {
  const provider = resolveProvider(model);
  const declared = provider?.supportsIdempotentDispatch === true
    || provider?.additionalEnvVars?.KANBAN_IDEMPOTENT_DISPATCH === '1';
  return process.env.USE_CODEX_DIRECT_API === '1'
    && provider?.kind === 'openai'
    && Boolean(provider.authToken)
    && declared;
}

export function assertKanbanProviderIdempotency(model) {
  if (!supportsKanbanProviderIdempotency(model)) {
    throw new Error('Lane-entry provider transport does not support idempotent dispatch');
  }
}
