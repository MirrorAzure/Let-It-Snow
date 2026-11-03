import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

/**
 * Сборка OBS-оверлея в dist/obs: один классический (IIFE) скрипт без
 * динамических импортов, чтобы страница работала и через relay, и из file://.
 */
const emitOverlayHtml = () => ({
  name: 'emit-obs-overlay-html',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'index.html',
      source: fs.readFileSync(path.resolve('src/obs/index.html'), 'utf8')
    });
  }
});

export default defineConfig({
  publicDir: false,
  plugins: [emitOverlayHtml()],
  define: {
    'process.env.BROWSER': JSON.stringify('obs'),
    'process.env.IS_PLAYGROUND': JSON.stringify(false),
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: 'dist/obs',
    emptyOutDir: true,
    lib: {
      entry: path.resolve('src/obs/overlay.js'),
      name: 'LetItSnowOBS',
      formats: ['iife'],
      fileName: () => 'overlay.js'
    },
    chunkSizeWarningLimit: 1500
  }
});
