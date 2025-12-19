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
      },
    },
  ],
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
  },
};
