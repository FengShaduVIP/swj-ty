// 硬件冒烟专用 vitest 配置：仅收集 scripts/**/*.hw.ts（真机串口测试）。
// 默认 `pnpm test`（无配置，匹配 **/*.test.ts）不会收集这些文件，
// 避免在无硬件环境（如 CI）误跑。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/**/*.hw.ts'],
    testTimeout: 60_000,
    hookTimeout: 15_000,
    reporters: 'default',
    // 串口是独占资源：hw 测试文件必须串行执行，禁止并行池抢占 COM 口
    fileParallelism: false,
  },
})
