import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';

export default defineConfig(({ mode }) => {
  // Load env vars from .env file (root directory)
  const env = loadEnv(mode, resolve(__dirname, '..'), '');
  
  return {
    root: resolve(__dirname),
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          content: resolve(__dirname, 'content.ts'),
          background: resolve(__dirname, 'background.ts'),
          popup: resolve(__dirname, 'popup.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js',
          assetFileNames: '[name].[ext]',
          format: 'es', // ES modules (Manifest V3 supports this)
        },
      },
      watch: process.env.WATCH === 'true' ? {} : null,
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, '../src'),
      },
      preserveSymlinks: false,
    },
    optimizeDeps: {
      include: ['@supabase/supabase-js', 'zod'],
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || '[YOUR-ANON-KEY]'),
    },
    plugins: [
      {
        name: 'copy-manifest',
        closeBundle() {
          const distDir = resolve(__dirname, 'dist');
          if (!existsSync(distDir)) {
            mkdirSync(distDir, { recursive: true });
          }
          copyFileSync(resolve(__dirname, 'manifest.json'), resolve(distDir, 'manifest.json'));
          copyFileSync(resolve(__dirname, 'popup.html'), resolve(distDir, 'popup.html'));
        },
      },
    ],
  };
});
