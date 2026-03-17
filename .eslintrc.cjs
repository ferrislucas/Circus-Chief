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
        'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      // Test files have relaxed rules for max-lines and max-params
      files: ['**/*.test.js'],
      rules: {
        'max-lines': 'off',
        'max-params': 'off',
      },
    },
  ],
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',

    // Complexity and size management rules
    // Phase 1: max-depth enforced (all violations fixed)
    'max-depth': ['error', 4],

    // Phase 2: max-params as warning (most critical violations fixed)
    'max-params': ['warn', 4],

    // Phase 3: complexity as warning at 20 (catches worst offenders)
    'complexity': ['warn', 20],

    // Phase 4: max-lines as warning at 500 (catches egregious files)
    'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
  },
};
