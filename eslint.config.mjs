import cdkPlugin from 'eslint-plugin-awscdk';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['cdk.out/**', 'dist/**', 'node_modules/**', 'jest.config.js'],
  },
  {
    files: ['bin/**/*.ts', 'lib/**/*.ts', 'test/**/*.ts'],
    extends: [...tseslint.configs.recommended, cdkPlugin.configs.recommended],
  },
);
