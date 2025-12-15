import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  plugins: [svelte()],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  build: {
    outDir: '../out',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'pages/app.ts'),
      name: 'app',
      formats: ['iife'],
      fileName: () => 'app.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'app.[ext]',
      },
    },
    sourcemap: true,
  },
});

