import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-host-apiproxy/api': path.resolve(__dirname, '../../vendor/deepseek-harness/packages/host/apiproxy/src/api/index.ts'),
      '@deepseek-ai/dsh-client-connection/client': path.resolve(__dirname, '../../vendor/deepseek-harness/packages/client/connection/src/client/index.ts'),
      '@deepseek-ai/dsh-session/types': path.resolve(__dirname, '../../vendor/deepseek-harness/packages/core/session/src/types.ts'),
      '@deepseek-ai/dsh-session': path.resolve(__dirname, '../../vendor/deepseek-harness/packages/core/session/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/runtime-live.test.ts'],
    testTimeout: 10_000,
  },
});
