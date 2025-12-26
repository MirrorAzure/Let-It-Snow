import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const packageJsonPath = path.join(rootDir, 'package.json');
const manifestPaths = [
  path.join(rootDir, 'src', 'manifest.json'),
  path.join(rootDir, 'src', 'manifests', 'manifest.chrome.json'),
  path.join(rootDir, 'src', 'manifests', 'manifest.firefox.json'),
  path.join(rootDir, 'src', 'manifests', 'manifest.edge.json')
];

function syncManifestVersions() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const version = pkg.version;

  manifestPaths.forEach((manifestPath) => {
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.version = version;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`✓ ${path.relative(rootDir, manifestPath)} → ${version}`);
  });
}

try {
  syncManifestVersions();
} catch (err) {
  console.error('Failed to sync versions:', err);
  process.exit(1);
}
