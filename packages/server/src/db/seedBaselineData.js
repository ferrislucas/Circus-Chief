import { OPENAI_MODELS, GEMINI_MODELS } from '@circuschief/shared';

export const BUILT_IN_ANTHROPIC_PROVIDER = {
  id: 'anthropic-default',
  name: 'Anthropic (Official)',
  kind: 'anthropic',
};

export const BUILT_IN_OPENAI_PROVIDER = {
  id: 'openai-default',
  name: 'OpenAI (Official)',
  kind: 'openai',
};

export const BUILT_IN_OPENAI_COMMIT_ATTRIBUTION = 'Co-authored-by: Codex <noreply@openai.com>';

export const BUILT_IN_GOOGLE_PROVIDER = {
  id: 'google-default',
  name: 'Google (Official)',
  kind: 'google',
};

export const BUILT_IN_ANTHROPIC_MODELS = [
  { id: 'anthropic-haiku', providerId: BUILT_IN_ANTHROPIC_PROVIDER.id, modelId: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fast & lightweight', tier: 'haiku' },
  { id: 'anthropic-sonnet', providerId: BUILT_IN_ANTHROPIC_PROVIDER.id, modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', description: 'Balanced', tier: 'sonnet' },
  { id: 'anthropic-opus', providerId: BUILT_IN_ANTHROPIC_PROVIDER.id, modelId: 'claude-opus-4-6', displayName: 'Opus 4.6', description: 'Previous generation', tier: 'opus' },
  { id: 'anthropic-opus-4-7', providerId: BUILT_IN_ANTHROPIC_PROVIDER.id, modelId: 'claude-opus-4-7', displayName: 'Opus 4.7', description: 'Previous generation', tier: 'opus' },
  { id: 'anthropic-opus-4-8', providerId: BUILT_IN_ANTHROPIC_PROVIDER.id, modelId: 'claude-opus-4-8', displayName: 'Opus 4.8', description: 'Most capable (default)', tier: 'opus' },
];

export const BUILT_IN_OPENAI_MODELS = OPENAI_MODELS.map((model) => ({
  id: model.seedId,
  providerId: BUILT_IN_OPENAI_PROVIDER.id,
  modelId: model.id,
  displayName: model.name,
  description: model.description,
  tier: 'custom',
}));

export const BUILT_IN_GOOGLE_MODELS = GEMINI_MODELS.map((model) => ({
  id: model.seedId,
  providerId: BUILT_IN_GOOGLE_PROVIDER.id,
  modelId: model.id,
  displayName: model.name,
  description: model.description,
  tier: 'custom',
}));

function seedBuiltInProviders(db) {
  const now = Date.now();

  db.prepare(
    `INSERT OR IGNORE INTO providers (
       id, name, base_url, auth_token, kind, is_built_in, created_at, updated_at
     )
     VALUES (?, ?, NULL, NULL, ?, 1, ?, ?)`
  ).run(BUILT_IN_ANTHROPIC_PROVIDER.id, BUILT_IN_ANTHROPIC_PROVIDER.name, BUILT_IN_ANTHROPIC_PROVIDER.kind, now, now);

  db.prepare(
    `INSERT OR IGNORE INTO providers (
       id, name, base_url, auth_token, kind, commit_attribution_override, is_built_in, created_at, updated_at
     )
     VALUES (?, ?, NULL, NULL, ?, ?, 1, ?, ?)`
  ).run(
    BUILT_IN_OPENAI_PROVIDER.id,
    BUILT_IN_OPENAI_PROVIDER.name,
    BUILT_IN_OPENAI_PROVIDER.kind,
    BUILT_IN_OPENAI_COMMIT_ATTRIBUTION,
    now,
    now
  );

  const insertModel = db.prepare(
    `INSERT OR IGNORE INTO provider_models (
       id, provider_id, model_id, display_name, description, tier, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  // Note: Google provider and models are NOT seeded here because seedBaselineData
  // runs before migrations. On existing databases the providers table still has
  // CHECK(kind IN ('anthropic','openai')), so an INSERT with kind='google' would
  // be silently ignored by INSERT OR IGNORE, and the subsequent model inserts
  // would fail with a FOREIGN KEY constraint. The 'providers-seed-built-in-google'
  // migration handles seeding Google for both fresh and existing databases after
  // the 'providers-widen-kind-check-google' migration has widened the CHECK constraint.
  for (const model of [...BUILT_IN_ANTHROPIC_MODELS, ...BUILT_IN_OPENAI_MODELS]) {
    insertModel.run(model.id, model.providerId, model.modelId, model.displayName, model.description, model.tier, now);
  }
}

export function seedBaselineData(db) {
  seedBuiltInProviders(db);
}
