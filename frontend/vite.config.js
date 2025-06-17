import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
// Vite config
export default defineConfig({
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
    proxy: {
      '/api': 'http://127.0.0.1:5000', // Proxy API requests to Flask backend
    },
  },
});
