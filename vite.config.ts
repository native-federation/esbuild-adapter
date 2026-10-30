import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  test: {
    name: 'esbuild',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: 'coverage',
      provider: 'v8' as const,
    },
  },
}));
