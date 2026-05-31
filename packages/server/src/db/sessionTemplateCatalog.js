import { createHash } from 'node:crypto';

export const BUILT_IN_SESSION_TEMPLATE_CATALOG_VERSION = 1;

export const DEFAULT_SESSION_TEMPLATE_PROMPTS = {
  REVIEW: `Review the plan on the canvas. If there's more than one plan then review the most recently updated plan. if there are no plans on the canvas then look for the most recently updated plan on the root session canvas.

Make sure there are tests explicitly called out for all changes. Make sure that all context necessary to hand off the task is included in the plan.

Are there any gaps in the plan? Is test coverage spelled out explicitly? Does the code match the assumptions in the plan?

Update the plan according to your review recommendations.`,
  IMPLEMENT: `Implement the plan on the canvas. If there's more than one plan on the canvas then use the most recently updated plan. If you don't see a plan on the canvas then look at the parent session's canvas.`,
  PR: `Ensure all relevant changes are committed and pushed. Then determine the session's goals. You can typically find details about the goals of the session by looking at the most recently modified markdown documents on the root session's canvas - these are typically plans that were implemented during the session. You can also look at the root session's summary, but don't trigger a new summary to be created if the summary is missing.

Create a draft pr and ensure all changes are committed and pushed.`,
  PUT_PLAN: `Put a plan on the canvas to get this done`,
  YES: `Yes`,
  CONTINUE: `Continue`,
};

export const LEGACY_DEFAULT_QUICK_RESPONSES = [
  { name: 'Put a plan on the canvas', prompt: 'Put a plan on the canvas to get this done', autoSubmit: false, sortOrder: 0 },
  { name: 'Yes', prompt: 'Yes', autoSubmit: true, sortOrder: 1 },
  { name: 'Review the plan', prompt: `Review the plan on the canvas. Are there any issues that you can find? Is test coverage specified explicitly enough? Does the current code match the assumptions in the plan?\n\nList the issues that you find and then update the plan on the canvas to address any issues that you find. Don't talk about issues with the original plan in the plan itself. Just tell me what the issues are, and update the plan so that the plan doesn't have the issues.`, autoSubmit: true, sortOrder: 2 },
  { name: 'Implement the plan on the canvas', prompt: 'Implement the plan on the canvas', autoSubmit: true, sortOrder: 3 },
  { name: 'Create / Update PR', prompt: `Ensure all relevant changes are committed and pushed. Then look at the session's summary and create a draft PR if no PR already exists.`, autoSubmit: true, sortOrder: 4 },
  { name: 'Review PR', prompt: 'Look at the PR related to the root session. Review the PR. Are there any issues? Are best practices adhered to? Does the PR accomplish the goal? Are all changes covered by tests?', autoSubmit: true, sortOrder: 5 },
  { name: 'Add tests', prompt: 'Inspect the changes on our branch. For each change, ensure we have tests that assert the change is working in the expected way. Implement the tests.', autoSubmit: true, sortOrder: 6 },
  { name: 'Merge in main', prompt: 'Merge in the latest main branch', autoSubmit: true, sortOrder: 7 },
  { name: 'Add tests to the plan', prompt: 'Call out specific test cases in the plan, we should have an assertion for each change called for in the plan', autoSubmit: true, sortOrder: 8 },
  { name: 'Tests are failing', prompt: 'Tests are failing. Look at the canvas for details', autoSubmit: true, sortOrder: 9 },
  { name: 'Continue', prompt: 'Continue', autoSubmit: true, sortOrder: 10 },
];

const LEGACY_BY_NAME = new Map(LEGACY_DEFAULT_QUICK_RESPONSES.map((item) => [item.name, item]));

function legacyAlias(name) {
  const item = LEGACY_BY_NAME.get(name);
  return item ? { name: item.name, prompt: item.prompt } : null;
}

const catalog = [
  {
    key: 'plan.review',
    name: 'Review the plan',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.REVIEW,
    showInQuickResponses: false,
    quickResponseAutoSubmit: false,
    quickResponseSortOrder: 0,
    legacyAliases: [legacyAlias('Review the plan')],
  },
  {
    key: 'plan.implement',
    name: 'Implement the plan on the canvas',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.IMPLEMENT,
    showInQuickResponses: false,
    quickResponseAutoSubmit: false,
    quickResponseSortOrder: 0,
    legacyAliases: [legacyAlias('Implement the plan on the canvas')],
  },
  {
    key: 'pr.create_or_update',
    name: 'Create/update PR',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.PR,
    showInQuickResponses: false,
    quickResponseAutoSubmit: false,
    quickResponseSortOrder: 0,
    legacyAliases: [legacyAlias('Create / Update PR')],
  },
  {
    key: 'quick.plan.put',
    name: 'Put a plan on the canvas',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.PUT_PLAN,
    showInQuickResponses: true,
    quickResponseAutoSubmit: false,
    quickResponseSortOrder: 0,
    legacyAliases: [legacyAlias('Put a plan on the canvas')],
  },
  {
    key: 'quick.yes',
    name: 'Yes',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.YES,
    showInQuickResponses: true,
    quickResponseAutoSubmit: true,
    quickResponseSortOrder: 1,
    legacyAliases: [legacyAlias('Yes')],
  },
  {
    key: 'quick.continue',
    name: 'Continue',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.CONTINUE,
    showInQuickResponses: true,
    quickResponseAutoSubmit: true,
    quickResponseSortOrder: 2,
    legacyAliases: [legacyAlias('Continue')],
  },
];

export const LEGACY_ONLY_SESSION_TEMPLATE_ALIASES = LEGACY_DEFAULT_QUICK_RESPONSES
  .filter((item) => !catalog.some((entry) => entry.legacyAliases.some((alias) => alias?.name === item.name)))
  .map((item) => ({
    name: item.name,
    prompt: item.prompt,
    promptFingerprint: promptFingerprint(item.prompt),
  }));

export function normalizePromptForFingerprint(prompt) {
  return String(prompt ?? '').replace(/\r\n/g, '\n').trim();
}

export function promptFingerprint(prompt) {
  return createHash('sha256').update(normalizePromptForFingerprint(prompt)).digest('hex');
}

function withFingerprints(entry) {
  return {
    ...entry,
    promptFingerprint: promptFingerprint(entry.prompt),
    legacyAliases: entry.legacyAliases
      .filter(Boolean)
      .map((alias) => ({
        ...alias,
        promptFingerprint: promptFingerprint(alias.prompt),
      })),
  };
}

export const BUILT_IN_SESSION_TEMPLATES = catalog.map(withFingerprints);

export const DEFAULT_SESSION_TEMPLATES = BUILT_IN_SESSION_TEMPLATES.map((entry) => ({
  key: entry.key,
  name: entry.name,
  prompt: entry.prompt,
  showInQuickResponses: entry.showInQuickResponses,
  quickResponseAutoSubmit: entry.quickResponseAutoSubmit,
  quickResponseSortOrder: entry.quickResponseSortOrder,
  promptFingerprint: entry.promptFingerprint,
}));

export function findCatalogEntryByExactTemplate({ name, prompt }) {
  const fingerprint = promptFingerprint(prompt);
  return BUILT_IN_SESSION_TEMPLATES.find((entry) => (
    entry.name === name && entry.promptFingerprint === fingerprint
  ));
}
