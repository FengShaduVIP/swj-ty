import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// 临时配置：仅含 Vue 插件 + @ 别名，去掉 electron 插件，
// 用于在 headless 浏览器里渲染 renderer 进行截图（不拉起 GUI 窗口）。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5180,
    strictPort: true,
    host: '127.0.0.1'
  }
})
