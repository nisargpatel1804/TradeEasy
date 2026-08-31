import { defineConfig, loadEnv } from "vite";
import process from "node:process";
import react from "@vitejs/plugin-react";

// Vite config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = env.VITE_API_BASE_URL ?? 'http://127.0.0.1:5000';
  const proxyTarget = env.VITE_PROXY_TARGET ?? apiBase;
  const useHttps = proxyTarget.startsWith('https://');

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': '/src',
      },
      extensions: [".js", ".jsx"],
    },
    build: {
      sourcemap: true,
      // polyfillDynamicImport: true, // Optional: Only needed for older browsers
    },
    server: {
      https: useHttps || undefined,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});