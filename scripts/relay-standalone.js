/**
 * Entry point of the standalone relay executable (Node.js single executable application).
 * Bundled to CommonJS by scripts/build-relay.js; the OBS overlay is embedded as SEA assets.
 */
import os from 'node:os';
import path from 'node:path';
import sea from 'node:sea';
import { runRelayCli } from './snow-relay.js';

/* global __RELAY_VERSION__ */
const VERSION = typeof __RELAY_VERSION__ === 'string' ? __RELAY_VERSION__ : 'dev';
const OVERLAY_MANIFEST_KEY = 'obs-manifest.json';

export function resolveDefaultTokenFile(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'LetItSnow', 'relay-token.txt');
  }
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', 'LetItSnow', 'relay-token.txt');
  }
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), 'let-it-snow', 'relay-token.txt');
}

const loadEmbeddedOverlay = () => {
  if (!sea?.isSea?.()) return undefined;
  try {
    const manifest = JSON.parse(sea.getAsset(OVERLAY_MANIFEST_KEY, 'utf8'));
    const files = new Map();
    for (const key of manifest.files) {
      files.set(key, Buffer.from(sea.getAsset(`obs/${key}`)));
    }
    return files;
  } catch (err) {
    console.error(`⚠ Embedded OBS overlay is unavailable: ${err.message}`);
    return new Map();
  }
};

const argv = process.argv.slice(2);
const launchedWithoutArgs = argv.length === 0;

runRelayCli(argv, {
  staticFiles: loadEmbeddedOverlay(),
  defaultTokenFile: resolveDefaultTokenFile(),
  version: VERSION,
  command: path.basename(process.execPath)
});

// Double-clicked on Windows: keep the console open so the error stays readable.
process.on('beforeExit', () => {
  if (process.exitCode === 1 && launchedWithoutArgs && process.stdin.isTTY) {
    console.log('\nPress Enter to close…');
    process.stdin.once('data', () => process.exit(1));
  }
});
