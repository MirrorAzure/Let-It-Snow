import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import chromeManifest from './src/manifests/manifest.chrome.json' with { type: 'json' };
import firefoxManifest from './src/manifests/manifest.firefox.json' with { type: 'json' };
import edgeManifest from './src/manifests/manifest.edge.json' with { type: 'json' };
import fs from 'fs';
import path from 'path';

const manifests = {
  chrome: chromeManifest,
  firefox: firefoxManifest,
  edge: edgeManifest
};

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
  const manifest = manifests[mode] || chromeManifest;
  
  // Плагин для копирования _locales после сборки
  const copyLocalesPlugin = () => ({
    name: 'copy-locales',
    closeBundle() {
      if (!isPlayground && mode) {
        const localesSrc = path.resolve('src/_locales');
        const localesDest = path.resolve(`dist/${mode}/_locales`);
        if (fs.existsSync(localesSrc)) {
          fs.cpSync(localesSrc, localesDest, { recursive: true });
          console.log('✓ Локализации скопированы');
        }
      }
    }
  });
  
  return {
    plugins: isPlayground ? [] : [crx({ manifest }), copyLocalesPlugin()],
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
