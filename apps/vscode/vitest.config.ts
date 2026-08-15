import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 连 3080 的集成测试用 @live 标记,无服务/无 key 时可跳过
    testTimeout: 10_000,
  },
});
