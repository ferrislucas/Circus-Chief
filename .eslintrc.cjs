module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['sonarjs'],
  extends: ['eslint:recommended'],
  overrides: [
    {
      // Vue and web JS files: parser + no-unused-vars rules
      files: ['packages/web/**/*.vue', 'packages/web/**/*.js'],
      extends: ['plugin:vue/vue3-recommended'],
      parser: 'vue-eslint-parser',
      parserOptions: {
        ecmaVersion: 2022,
      },
      env: {
        browser: true,
        node: false,
      },
      rules: {
        // Use Vue's no-unused-vars which understands template usage
        'no-unused-vars': 'off',
        'vue/no-unused-vars': ['error', { ignorePattern: '^_' }],
      },
    },
    {
      // Vue files get a higher max-lines limit to accommodate expanded <style> blocks (ratcheted 800 → 600)
      files: ['packages/web/**/*.vue'],
      rules: {
        'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      // Vue composables are intentionally cohesive modules - allow larger functions (ratcheted 300 → 250)
      // Complex subscription/initialization composables benefit from cohesion
      files: ['packages/web/src/composables/use*.js'],
      excludedFiles: ['**/*.test.js'],
      rules: {
        'max-lines-per-function': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      // API resource classes are wrapper collections - allow larger functions (ratcheted 200 → 150)
      files: ['packages/web/src/api/resources/*Api.js'],
      rules: {
        'max-lines-per-function': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      // Test files have relaxed rules - MUST come last to override other patterns
      files: ['**/*.test.js'],
      rules: {
        'max-lines': 'off',
        'max-params': 'off',
        'max-lines-per-function': 'off',
        'max-nested-callbacks': ['warn', 5],
        // SonarJS rules are too noisy for test files (repeated strings, similar test helpers)
        'sonarjs/no-duplicate-string': 'off',
        'sonarjs/no-identical-functions': 'off',
        'sonarjs/cognitive-complexity': 'off',
        // Test files intentionally define multiple stub/mock components inline
        'vue/one-component-per-file': 'off',
        // Test stub components don't need full prop type definitions
        'vue/require-prop-types': 'off',
      },
    },
  ],
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',

    // Complexity and size management rules
    // Phase 1: max-depth enforced, ratcheted from 4 → 3 in PR 4
    'max-depth': ['error', 3],

    // max-params enforced (all production violations fixed)
    'max-params': ['error', 4],

    // complexity enforced, ratcheted from 15 → 12 in PR 4
    'complexity': ['error', 12],

    // max-lines ratcheted from 400 → 300 in PR 4 (Vue files get 600 via override)
    'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],

    // max-lines-per-function ratcheted from 100 → 80 in PR 4
    'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],

    // max-nested-callbacks enforced at 3
    'max-nested-callbacks': ['error', 3],

    // Phase 1 (PR 1): Hygiene rules
    // Correctness — partially or not auto-fixable, manual review expected
    // Allow `== null` / `!= null` as it's a deliberate idiom to match both null and undefined.
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    // Allow mutating Express req/res as it's a standard middleware pattern.
    // Also allow modifying Pinia stores, Vue refs, and DOM elements passed as parameters.
    'no-param-reassign': [
      'error',
      { props: true, ignorePropertyModificationsFor: ['req', 'res', 'store', 'textarea', 'textareaRef', 'formState'] },
    ],
    'no-shadow': 'error',
    'no-return-await': 'error',
    'no-implicit-coercion': 'error',
    'no-duplicate-imports': 'error',

    // Style / clarity (auto-fixable)
    'prefer-const': 'error',
    'prefer-template': 'error',
    'no-unneeded-ternary': 'error',
    'arrow-body-style': ['error', 'as-needed'],
    'object-shorthand': ['error', 'always'],

    // Phase 2 (PR 2): SonarJS metrics — now enforced as errors
    // Note: We add just the 3 target rules rather than extending the full sonarjs/recommended
    // preset, which in v4 has 204 rules — too many to adopt at once.
    'sonarjs/cognitive-complexity': ['error', 15],
    'sonarjs/no-duplicate-string': ['error', { threshold: 5 }],
    'sonarjs/no-identical-functions': 'error',
  },
};
