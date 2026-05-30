import { randomUUID } from 'node:crypto';
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

export const DEFAULT_QUICK_RESPONSES = [
  { label: 'Put a plan on the canvas', content: 'Put a plan on the canvas to get this done', autoSubmit: false, sortOrder: 0 },
  { label: 'Yes', content: 'Yes', autoSubmit: true, sortOrder: 1 },
  { label: 'Review the plan', content: `Review the plan on the canvas. Are there any issues that you can find? Is test coverage specified explicitly enough? Does the current code match the assumptions in the plan?\n\nList the issues that you find and then update the plan on the canvas to address any issues that you find. Don't talk about issues with the original plan in the plan itself. Just tell me what the issues are, and update the plan so that the plan doesn't have the issues.`, autoSubmit: true, sortOrder: 2 },
  { label: 'Implement the plan on the canvas', content: 'Implement the plan on the canvas', autoSubmit: true, sortOrder: 3 },
  { label: 'Create / Update PR', content: `Ensure all relevant changes are committed and pushed. Then look at the session's summary and create a draft PR if no PR already exists.`, autoSubmit: true, sortOrder: 4 },
  { label: 'Review PR', content: 'Look at the PR related to the root session. Review the PR. Are there any issues? Are best practices adhered to? Does the PR accomplish the goal? Are all changes covered by tests?', autoSubmit: true, sortOrder: 5 },
  { label: 'Add tests', content: 'Inspect the changes on our branch. For each change, ensure we have tests that assert the change is working in the expected way. Implement the tests.', autoSubmit: true, sortOrder: 6 },
  { label: 'Merge in main', content: 'Merge in the latest main branch', autoSubmit: true, sortOrder: 7 },
  { label: 'Add tests to the plan', content: 'Call out specific test cases in the plan, we should have an assertion for each change called for in the plan', autoSubmit: true, sortOrder: 8 },
  { label: 'Tests are failing', content: 'Tests are failing. Look at the canvas for details', autoSubmit: true, sortOrder: 9 },
  { label: 'Continue', content: 'Continue', autoSubmit: true, sortOrder: 10 },
];

export const DEFAULT_SESSION_TEMPLATE_PROMPTS = {
  REVIEW: `Review the plan on the canvas. If there's more than one plan then review the most recently updated plan. if there are no plans on the canvas then look for the most recently updated plan on the root session canvas.

Make sure there are tests explicitly called out for all changes. Make sure that all context necessary to hand off the task is included in the plan.

Are there any gaps in the plan? Is test coverage spelled out explicitly? Does the code match the assumptions in the plan?

Update the plan according to your review recommendations.`,
  IMPLEMENT: `Implement the plan on the canvas. If there's more than one plan on the canvas then use the most recently updated plan. If you don't see a plan on the canvas then look at the parent session's canvas.`,
  PR: `Ensure all relevant changes are committed and pushed. Then determine the session's goals. You can typically find details about the goals of the session by looking at the most recently modified markdown documents on the root session's canvas - these are typically plans that were implemented during the session. You can also look at the root session's summary, but don't trigger a new summary to be created if the summary is missing.

Create a draft pr and ensure all changes are committed and pushed.`,
};

export const DEFAULT_SESSION_TEMPLATES = [
  { name: 'Review the plan', prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.REVIEW },
  { name: 'Implement the plan on the canvas', prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.IMPLEMENT },
  { name: 'Create/update PR', prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.PR },
];

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

function seedDefaultQuickResponses(db) {
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM quick_responses').get().cnt;
  if (count > 0) return;

  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO quick_responses (
       id, project_id, label, content, auto_submit, category, sort_order, created_at, updated_at
     )
     VALUES (?, NULL, ?, ?, ?, NULL, ?, ?, ?)`
  );

  for (const item of DEFAULT_QUICK_RESPONSES) {
    stmt.run(randomUUID(), item.label, item.content, item.autoSubmit ? 1 : 0, item.sortOrder, now, now);
  }
}

function seedDefaultSessionTemplates(db) {
  const count = db.prepare(
    'SELECT COUNT(*) AS cnt FROM session_templates WHERE project_id IS NULL'
  ).get().cnt;
  if (count > 0) return;

  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO session_templates (
      id, project_id, name, prompt,
      next_template_id, thinking_enabled,
      git_branch, git_mode, model, mode, effort_level, target_lane_id,
      created_at, updated_at
    ) VALUES (?, NULL, ?, ?, NULL, 1, NULL, NULL, NULL, 'yolo', NULL, NULL, ?, ?)
  `);

  for (const item of DEFAULT_SESSION_TEMPLATES) {
    stmt.run(randomUUID(), item.name, item.prompt, now, now);
  }
}

export function seedBaselineData(db) {
  seedBuiltInProviders(db);
  seedDefaultQuickResponses(db);
  seedDefaultSessionTemplates(db);
}
