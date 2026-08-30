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
