import eslint from '@eslint/js';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.tauri/**',
      '.expo/**'
    ]
  },
  eslint.configs.recommended
];
