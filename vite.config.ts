import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
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
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})
