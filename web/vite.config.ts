import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 生产模式由 Express 托管单页应用，深路由（如 /tasks、/history）刷新时
  // 需要从站点根加载资源；使用相对 base './' 会导致 /tasks/assets/... 404 白屏。
  base: '/',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
