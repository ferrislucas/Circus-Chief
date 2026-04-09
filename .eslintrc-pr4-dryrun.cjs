// Temporary dry-run config for PR 4 target rule set
// Used to identify all files that would block PR 4 from landing clean
const baseConfig = require('./.eslintrc.cjs');

module.exports = {
  ...baseConfig,
  overrides: baseConfig.overrides.map(override => {
    const rules = { ...override.rules };

    // Vue files: 600 instead of 800
    if (override.files?.includes('packages/web/**/*.vue') && rules['max-lines']) {
      rules['max-lines'] = ['error', { max: 600, skipBlankLines: true, skipComments: true }];
    }
    // Composables: 250 instead of 300
    if (override.files?.includes('packages/web/src/composables/use*.js') && rules['max-lines-per-function']) {
      rules['max-lines-per-function'] = ['error', { max: 250, skipBlankLines: true, skipComments: true }];
    }
    // Api files: 150 instead of 200
    if (override.files?.includes('packages/web/src/api/resources/*Api.js') && rules['max-lines-per-function']) {
      rules['max-lines-per-function'] = ['error', { max: 150, skipBlankLines: true, skipComments: true }];
    }
    return { ...override, rules };
  }),
  rules: {
    ...baseConfig.rules,
    // PR 4 targets
    'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
    'complexity': ['error', 12],
    'max-depth': ['error', 3],
  },
};
