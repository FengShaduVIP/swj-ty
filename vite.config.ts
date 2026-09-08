import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'path'
import pkg from './package.json'

export default defineConfig({
  // 渲染层版本号编译期注入，替代 `import pkg from '../package.json'`
  // （后者会把整个 package.json —— 含全部依赖清单 —— 打进 bundle）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    vue(),
    // Element Plus 按需引入：模板中的 el-* 组件编译期解析为按需 import，
    // 只打包实际用到的组件及其样式（ElMessage/ElMessageBox 为 JS 直调 API，
    // 样式在 main.ts 手动引入）。dirs: [] 关闭本地目录扫描，保持显式导入习惯。
    Components({
      dirs: [],
      dts: 'src/components.d.ts',
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
    }),
    electron([
      {
        entry: 'electron/main.ts',
        // 关闭 @electron/rebuild：serialport/bindings-cpp 已通过 pnpm install
        // 安装预编译 N-API 二进制（ABI 稳定，Node/Electron 通用），无需重编译。
        // CI 环境（windows-latest）默认无 VS 编译工具，重编译必失败。
        rebuild: false,
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['serialport', '@serialport/bindings-cpp']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ]),
    renderer()
  ],
  // 默认端口 5173 落在本机 Windows 保留端口段（5147~5246，Hyper-V/WinNAT 动态保留），
  // 启动报 listen EACCES ::1:5173，故改用保留段之外的 5347。
  server: {
    port: 5347
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})
