import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { visualizer } from 'rollup-plugin-visualizer'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
    visualizer({ open: false, filename: 'stats.html', gzipSize: true, brotliSize: true })
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:22580',
        changeOrigin: true
      }
    }
  }
})
