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
  extends: ['eslint:recommended'],
  overrides: [
    {
      // Vue and web JS files: parser + no-unused-vars rules
      files: ['packages/web/**/*.vue', 'packages/web/**/*.js'],
      extends: ['plugin:vue/vue3-essential'],
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
      // Only .vue files get the relaxed max-lines of 500
      files: ['packages/web/**/*.vue'],
      rules: {
        'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      // Vue composables are intentionally cohesive modules - allow larger functions
      // Complex subscription/initialization composables benefit from cohesion
      files: ['packages/web/src/composables/use*.js'],
      excludedFiles: ['**/*.test.js'],
      rules: {
        'max-lines-per-function': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      // API resource classes are wrapper collections - allow larger functions
      files: ['packages/web/src/api/resources/*Api.js'],
      rules: {
        'max-lines-per-function': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
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
      },
    },
  ],
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',

    // Complexity and size management rules
    // Phase 1: max-depth enforced (all violations fixed)
    'max-depth': ['error', 4],

    // max-params enforced (all production violations fixed)
    'max-params': ['error', 4],

    // complexity enforced at 15
    'complexity': ['error', 15],

    // max-lines enforced at 400 (Vue files get 500 via override)
    'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],

    // max-lines-per-function enforced at 100 lines (allows reasonable sequential flows)
    'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: true }],

    // max-nested-callbacks enforced at 3
    'max-nested-callbacks': ['error', 3],
  },
};
