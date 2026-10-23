import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    execArgv: ['--disable-warning=ExperimentalWarning'],
    coverage: { include: ['src/**/*.ts'], exclude: ['src/web/**'] },
  },
});
