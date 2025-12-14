import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { DEFAULT_WEB_PORT, DEFAULT_SERVER_PORT } from '@claudetools/shared';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: DEFAULT_WEB_PORT,
    host: true,
    proxy: {
      '/api': {
        target: `http://localhost:${DEFAULT_SERVER_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${DEFAULT_SERVER_PORT}`,
        ws: true,
      },
    },
  },
});
