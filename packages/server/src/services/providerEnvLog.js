/**
 * Kind-specific buildProviderEnv diagnostics. Kept out of sessionProvider.js
 * so the env builder stays within the file-size limit.
 */
export function logProviderEnv(provider, kind, env) {
  if (kind === 'openai') {
    console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" (openai) env vars:`, {
      OPENAI_BASE_URL: env.OPENAI_BASE_URL,
      OPENAI_API_KEY: env.OPENAI_API_KEY ? '[SET]' : '[NOT SET]',
      API_TIMEOUT_MS: env.API_TIMEOUT_MS,
    });
    return;
  }

  if (kind === 'google') {
    console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" (google) env vars:`, {
      GEMINI_API_KEY: env.GEMINI_API_KEY ? '[SET]' : '[NOT SET]',
      API_TIMEOUT_MS: env.API_TIMEOUT_MS,
    });
    return;
  }

  if (kind === 'meta' || kind === 'xai') {
    logHostAuthProvider(provider, kind, env);
    return;
  }

  console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" (anthropic) env vars:`, {
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ? '[SET]' : '[NOT SET]',
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? '[SET]' : '[NOT SET]',
    ANTHROPIC_DEFAULT_FABLE_MODEL: env.ANTHROPIC_DEFAULT_FABLE_MODEL,
    ANTHROPIC_DEFAULT_SONNET_MODEL: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  });
}

function logHostAuthProvider(provider, kind, env) {
  const detail = kind === 'xai'
    ? 'uses the host grok login.'
    : 'uses host muse auth credentials.';
  console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" (${kind}) ${detail}`, {
    authToken: provider.authToken ? '[SET, IGNORED]' : '[NOT SET]',
    baseUrl: provider.baseUrl || '[NOT SET]',
    API_TIMEOUT_MS: env.API_TIMEOUT_MS,
  });
}
