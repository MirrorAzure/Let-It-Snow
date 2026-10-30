import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));

const manifests = [
  path.join(rootDir, 'src', 'manifest.json'),
  path.join(rootDir, 'src', 'manifests', 'manifest.chrome.json'),
  path.join(rootDir, 'src', 'manifests', 'manifest.firefox.json'),
  path.join(rootDir, 'src', 'manifests', 'manifest.edge.json')
];

describe('manifests', () => {
  const readManifest = (manifestPath) =>
    JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  it('all manifests exist', () => {
    manifests.forEach((m) => {
      expect(fs.existsSync(m)).toBe(true);
    });
  });

  it('versions stay in sync with package.json', () => {
    manifests.forEach((m) => {
      const manifest = JSON.parse(fs.readFileSync(m, 'utf-8'));
      expect(manifest.version).toBe(pkg.version);
    });
  });

  it('uses manifest v3 with default locale', () => {
    manifests.forEach((m) => {
      const manifest = JSON.parse(fs.readFileSync(m, 'utf-8'));
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.default_locale).toBeDefined();
    });
  });

  it('uses the background script format supported by each browser', () => {
    const chromeManifest = readManifest(manifests[1]);
    const firefoxManifest = readManifest(manifests[2]);
    const edgeManifest = readManifest(manifests[3]);

    expect(chromeManifest.background.service_worker).toBe('src/background.js');
    expect(firefoxManifest.background.scripts).toEqual(['src/background.js']);
    expect(edgeManifest.background.service_worker).toBe('src/background.js');
  });
});
