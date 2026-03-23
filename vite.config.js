/**
 * FISCAL NA OBRA — vite.config.js (v24.0)
 * Content hash ativado: garante cache busting após cada deploy.
 * PurgeCSS configurado estaticamente (sem import dinâmico em buildStart).
 */

import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    target: 'es2020',
    chunkSizeWarningLimit: 1024,

    rollupOptions: {
      input: 'index.html',
      output: {
        // v24.0: hash no nome garante cache busting automático após deploy
        entryFileNames:  'assets/[name]-[hash].js',
        chunkFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash][extname]',

        manualChunks(id) {
          if (id.includes('firebase') || id.includes('gstatic'))
            return 'vendor-firebase';
          if (
            id.includes('modules/sinapi')            ||
            id.includes('modules/fotos-medicao')     ||
            id.includes('modules/checklist-tecnico') ||
            id.includes('modules/etapas-pac')        ||
            id.includes('modules/relatorio-federal') ||
            id.includes('modules/modo-campo')        ||
            id.includes('modules/qualidade')
          ) return 'modulos-pac';
          if (
            id.includes('modules/responsaveis')        ||
            id.includes('modules/sancoes')             ||
            id.includes('modules/prazos')              ||
            id.includes('modules/recebimento')         ||
            id.includes('modules/riscos')              ||
            id.includes('modules/integracao-lei14133')
          ) return 'modulos-lei14133';
        },
      },
    },
  },

  server: { port: 5000, open: true, fs: { strict: false } },

  plugins: [],
  optimizeDeps: { exclude: ['firebase'] },
});
