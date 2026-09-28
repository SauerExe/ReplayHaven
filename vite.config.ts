/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  // Password hashing uses the full scrypt cost (server/auth.ts), so account tests need more
  // than the default five seconds, above all while files run in parallel.
  test: { testTimeout: 30_000 },
});
