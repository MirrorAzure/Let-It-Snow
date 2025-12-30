import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

const getBrowserConfig = (mode) => {
  const outDir = `dist/${mode}`;
  
  return {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        assetFileNames: '[name].[ext]',
        chunkFileNames: '[name].js',
        entryFileNames: '[name].js'
      }
    }
  };
};

export default defineConfig(({ mode }) => {
  const isPlayground = process.env.PLAYGROUND === 'true';
  
  return {
    plugins: isPlayground ? [] : [crx({ manifest })],
    server: isPlayground ? {
      open: '/playground/index.html',
      middleware: [],
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: 5173
      }
    } : undefined,
    build: getBrowserConfig(mode || 'chrome'),
    define: {
      'process.env.BROWSER': JSON.stringify(mode || 'chrome'),
      'process.env.IS_PLAYGROUND': JSON.stringify(isPlayground)
    }
  };
});
