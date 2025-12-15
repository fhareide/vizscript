import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  build: {
    outDir: resolve(__dirname, '../out'),
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
