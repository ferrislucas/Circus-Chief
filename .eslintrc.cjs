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
        // Vue components often need more lines due to template/script/style sections
        'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      // Test files have relaxed rules for max-lines, max-params, and max-nested-callbacks
      files: ['**/*.test.js'],
      rules: {
        'max-lines': 'off',
        'max-params': 'off',
        'max-nested-callbacks': ['warn', 5],
        'max-lines-per-function': 'off',
      },
    },
  ],
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',

    // Complexity and size management rules
    // Phase 1: max-depth enforced (all violations fixed)
    'max-depth': ['error', 4],

    // max-params enforced (all violations fixed)
    'max-params': ['error', 4],

    // complexity enforced at 15 (industry standard: 10-15)
    'complexity': ['error', 15],

    // max-nested-callbacks enforced at 3
    'max-nested-callbacks': ['error', 3],

    // max-lines-per-function enforced at 80
    'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],

    // max-lines enforced at 400
    'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
  },
};
