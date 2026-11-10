#!/usr/bin/env node

/**
 * Verify playground setup
 * Checks that all necessary files are in place for playground to work
 */

import { existsSync, readFileSync } from 'fs';
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
const requiredPhysicsControls = [
  'snowFluffiness',
  'snowShape',
  'snowShapeOverrides',
  'gravity',
  'airDensity',
  'windGustStrength',
  'turbulenceStrength',
  'updraftStrength'
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
  const indexHtml = readFileSync(resolve(rootDir, 'playground/index.html'), 'utf8');
  const mainJs = readFileSync(resolve(rootDir, 'playground/main.js'), 'utf8');
  const missingControls = requiredPhysicsControls.filter((id) =>
    !indexHtml.includes(`id="${id}"`) || !mainJs.includes(`getElementById('${id}')`)
  );
  if (missingControls.length > 0) {
    console.error(`❌ Missing physics controls: ${missingControls.join(', ')}`);
    process.exit(1);
  }
  if (indexHtml.includes('id="sinkspeed"') || mainJs.includes('sinkspeed')) {
    console.error('❌ Playground still exposes the legacy fall-speed control');
    process.exit(1);
  }
  if (!indexHtml.includes('value="auto"') || !mainJs.includes('snowShapeOverrides: parseSnowShapeOverrides')) {
    console.error('❌ Automatic shape selection or per-flake overrides are not configured');
    process.exit(1);
  }

  console.log('✅ All playground files are in place!');
  console.log('✅ Physics controls, automatic shape selection, and per-flake overrides are wired.');
  console.log('✅ Fall speed is calculated automatically.');
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
