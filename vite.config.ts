import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// BASE_PATH is set in CI from actions/configure-pages, so the same build works
// for project sites (/repo/), user sites (/) and custom domains.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
});
