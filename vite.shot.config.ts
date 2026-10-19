import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'path'

// 临时配置：仅含 Vue 插件 + Element Plus 按需解析 + @ 别名，去掉 electron 插件，
// 用于在 headless 浏览器里渲染 renderer 进行截图（不拉起 GUI 窗口）。
// Components 解析器与 vite.config.ts 保持一致：缺了它模板里的 el-* 组件不会被解析，
// 预览会渲染成未知元素（如 el-progress 空标签不显示进度条），与真实应用不符。
export default defineConfig({
  plugins: [
    vue(),
    Components({
      dirs: [],
      // 预览配置不生成 components.d.ts（主配置已生成 src/components.d.ts，避免根目录多出一份）
      dts: false,
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
    }),
  ],
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
