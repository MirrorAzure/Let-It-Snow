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
  return {
    plugins: [crx({ manifest })],
    build: getBrowserConfig(mode || 'chrome'),
    define: {
      'process.env.BROWSER': JSON.stringify(mode || 'chrome')
    }
  };
});
