/**
 * Default global session template definitions.
 *
 * Exported from a single location so that bootstrapDefaultSessionTemplates and
 * tests can reference the same constants without duplication.
 */

/**
 * Prompt strings for the default global session templates.
 * Exported so tests can assert verbatim equality.
 */
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

/**
 * The six default global session templates created on a fresh database.
 *
 * All defaults are visible as quick responses. Only the short affirmative
 * actions auto-submit.
 */
export const DEFAULT_SESSION_TEMPLATES = [
  {
    name: 'Review the plan',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.REVIEW,
    showInQuickResponses: true,
    quickResponseAutoSubmit: false,
    quickResponseSortOrder: 0,
  },
  {
    name: 'Implement the plan on the canvas',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.IMPLEMENT,
    showInQuickResponses: true,
    quickResponseAutoSubmit: false,
    quickResponseSortOrder: 1,
  },
  {
    name: 'Create/update PR',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.PR,
    showInQuickResponses: true,
    quickResponseAutoSubmit: false,
    quickResponseSortOrder: 2,
  },
  {
    name: 'Put a plan on the canvas',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.PUT_PLAN,
    showInQuickResponses: true,
    quickResponseAutoSubmit: false,
    quickResponseSortOrder: 3,
  },
  {
    name: 'Yes',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.YES,
    showInQuickResponses: true,
    quickResponseAutoSubmit: true,
    quickResponseSortOrder: 4,
  },
  {
    name: 'Continue',
    prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.CONTINUE,
    showInQuickResponses: true,
    quickResponseAutoSubmit: true,
    quickResponseSortOrder: 5,
  },
];
