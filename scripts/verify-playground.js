#!/usr/bin/env node

/**
 * Verify playground setup
 * Checks that all necessary files are in place for playground to work
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');

const requiredFiles = [
  'playground/index.html',
  'playground/main.js',
  'playground/style.css',
  'playground/content-script.js',
  'src/content/index.js',
  'scripts/playground-server.js',
  'vite.config.js',
  'package.json'
];

console.log('🔍 Verifying playground setup...\n');

let allOk = true;
requiredFiles.forEach(file => {
  const fullPath = resolve(rootDir, file);
  const exists = existsSync(fullPath);
  const status = exists ? '✓' : '✗';
  console.log(`${status} ${file}`);
  if (!exists) allOk = false;
});

console.log();

if (allOk) {
  console.log('✅ All playground files are in place!');
  console.log('\n📚 To start the playground:');
  console.log('   pnpm run playground');
  console.log('\n🎨 The playground will:');
  console.log('   • Load at http://localhost:5173/playground/');
  console.log('   • Use source code from src/content/index.js');
  console.log('   • Support hot reload for real-time testing');
  console.log('   • Run without requiring extension installation');
  process.exit(0);
} else {
  console.log('❌ Some playground files are missing!');
  process.exit(1);
}
