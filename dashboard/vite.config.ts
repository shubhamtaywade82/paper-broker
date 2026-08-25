import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd() + '/..', '');
  const port = env.PORT || '8081';
  const backendHttp = `http://localhost:${port}`;
  const backendWs = `ws://localhost:${port}`;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: backendHttp, changeOrigin: true },
        '/orders': { target: backendHttp, changeOrigin: true },
        '/engine': { target: backendHttp, changeOrigin: true },
        '/ws': { target: backendWs, ws: true },
      },
    },
  };
});
