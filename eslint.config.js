import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      // Zod internals and provider API responses require `any` access
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow underscore-prefixed vars for intentional discards (destructuring)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: ['dist/', 'examples/', 'node_modules/'],
  },
);
